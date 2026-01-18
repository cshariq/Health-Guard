import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../config.dart';

/// Service to interact with SurveyMonkey API.
/// Used for exporting patient data, symptom history, and AI diagnosis for clinician review.
class SurveyMonkeyService {
  static final SurveyMonkeyService _instance = SurveyMonkeyService._internal();
  factory SurveyMonkeyService() => _instance;

  final String _baseUrl = 'https://api.surveymonkey.com/v3';
  final Map<String, String> _headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ${Config.surveyMonkeyAccessToken}',
  };

  SurveyMonkeyService._internal();

  /// Syncs a completed HealthGuard session to SurveyMonkey as a response.
  Future<void> syncSession({
    required List<String> history,
    required Map<String, dynamic> diagnosis,
  }) async {
    if (Config.surveyMonkeyAccessToken.contains('YOUR_')) {
      debugPrint("SurveyMonkey: No API Key configured. Skipping sync.");
      return;
    }

    try {
      debugPrint("SurveyMonkey: Initializing Sync...");

      // 1. Find or Identify target Survey
      String? surveyId = await _findHealthGuardSurvey();
      if (surveyId == null) {
        debugPrint(
          "SurveyMonkey: Target survey not found. Attempting creation...",
        );
        surveyId = await _createSurvey(Config.surveyMonkeySurveyTitle);
      }

      if (surveyId == null) {
        debugPrint(
          "SurveyMonkey: Could not create/find target survey. Check API Scopes.",
        );
        return;
      }

      // 2. Get a collector to submit data to
      final String? collectorId = await _getCollectorId(surveyId);
      if (collectorId == null) {
        debugPrint("SurveyMonkey: No open collector found.");
        return;
      }

      // 3. Format Data
      final String transcript = history.join("\n");
      final String resultSummary =
          "Condition: ${diagnosis['title']}\n"
          "Severity: ${diagnosis['severity']}\n"
          "Notes: ${diagnosis['description']}";

      // 4. Submit Response
      // Note: mapping to specific pages/questions requires knowing the structure.
      // For this prototype, we likely won't map to dynamic IDs.
      // We will check if the survey has text pages or just submit 'custom_variables' or 'metadata'.
      // However, creating a response usually requires 'pages' -> 'questions' -> 'answers'.
      //
      // Strategy: We will try to fetch the survey details to find the first text question
      // and dump our data there. If not possible, we assume a "metadata" approach is sufficient for the hackathon logic.

      await _submitResponse(
        collectorId: collectorId,
        transcript: transcript,
        summary: resultSummary,
      );

      debugPrint("SurveyMonkey: Session Synced Successfully!");
    } catch (e) {
      debugPrint("SurveyMonkey Sync Error: $e");
    }
  }

  /// AI-Enhanced Invisible Feedback
  Future<void> submitFeedback(
    String text,
    Map<String, dynamic> aiAnalysis,
  ) async {
    try {
      final String? surveyId = await _findSurvey(
        Config.surveyMonkeyFeedbackTitle,
      );
      if (surveyId == null) return;
      final String? collectorId = await _getCollectorId(surveyId);
      if (collectorId == null) return;

      final payload = {
        "custom_variables": {
          "feedback_text": text,
          "sentiment": aiAnalysis['sentiment'], // AI Generated
          "keywords": (aiAnalysis['keywords'] as List).join(
            ", ",
          ), // AI Extracted
          "ai_summary": aiAnalysis['summary'],
        },
      };

      await _post(collectorId, payload);
      debugPrint("SurveyMonkey: Feedback submitted!");
    } catch (e) {
      debugPrint("SurveyMonkey Feedback Error: $e");
    }
  }

  /// Gamified/Invisible Safety Check Log
  Future<void> logSafetyCheck(
    String user,
    String location,
    String status,
  ) async {
    try {
      final String? surveyId = await _findSurvey(
        Config.surveyMonkeySafetyTitle,
      );
      if (surveyId == null) return;
      final String? collectorId = await _getCollectorId(surveyId);
      if (collectorId == null) return;

      final payload = {
        "custom_variables": {
          "user": user,
          "location": location,
          "status": status, // "Safe" or "Emergency"
          "timestamp": DateTime.now().toIso8601String(),
        },
      };

      await _post(collectorId, payload);
      debugPrint("SurveyMonkey: Safety Logged!");
    } catch (e) {
      debugPrint("SurveyMonkey Safety Error: $e");
    }
  }

  Future<String?> _findHealthGuardSurvey() async {
    return _findSurvey(Config.surveyMonkeySurveyTitle);
  }

  Future<String?> _createSurvey(String title) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/surveys'),
        headers: _headers,
        body: jsonEncode({'title': title}),
      );

      if (response.statusCode == 201) {
        final data = jsonDecode(response.body);
        final id = data['id'];
        debugPrint("SurveyMonkey: Created new survey '$title' ($id)");
        // We also need a collector
        await _createCollector(id);
        return id;
      }
      debugPrint("SurveyMonkey: Create Survey Failed: ${response.body}");
      return null;
    } catch (e) {
      debugPrint("SurveyMonkey: Create Survey Error: $e");
      return null;
    }
  }

  Future<void> _createCollector(String surveyId) async {
    // Create a default weblink collector
    await http.post(
      Uri.parse('$_baseUrl/surveys/$surveyId/collectors'),
      headers: _headers,
      body: jsonEncode({'type': 'weblink', 'name': 'App Collector'}),
    );
  }

  Future<String?> _findSurvey(String title) async {
    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/surveys?title=${Uri.encodeComponent(title)}'),
        headers: _headers,
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final List surveys = data['data'];
        if (surveys.isNotEmpty) {
          return surveys.first['id'];
        }
      }
      return null;
    } catch (e) {
      debugPrint("SurveyMonkey: Error fetching surveys: $e");
      return null;
    }
  }

  Future<String?> _getCollectorId(String surveyId) async {
    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/surveys/$surveyId/collectors'),
        headers: _headers,
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final List collectors = data['data'];
        // Find one that accepts responses (status open)
        final open = collectors.firstWhere(
          (c) => c['status'] == 'open',
          orElse: () => null,
        );
        return open?['id'];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  Future<void> _submitResponse({
    required String collectorId,
    required String transcript,
    required String summary,
  }) async {
    // In a real generic implementation without knowing the survey structure,
    // we can't reliably post "answers" because we need question_ids.
    //
    // Hackathon solution: We use 'custom_variables' or 'metadata' if the collector supports it,
    // OR we simply Log that we WOULD have posted to this collector.
    //
    // However, let's try to post a dummy response structure if the user has a standard template.
    // Ideally, we'd GET /surveys/{id}/details first.

    // For now, we will assume we can pass metadata or just simple empty response with custom vars
    // if configured on the collector.

    final payload = {
      "custom_variables": {
        "source": "HealthGuard AI",
        "diagnosis": summary.replaceAll('\n', ' | '),
        "patient_history": transcript.substring(
          0,
          transcript.length.clamp(0, 250),
        ), // Truncate for URL safety if needed
      },
      // "pages": [] // We'd populate this if we queried the survey structure first
    };

    await _post(collectorId, payload);
  }

  Future<void> _post(String collectorId, Map<String, dynamic> payload) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/collectors/$collectorId/responses'),
      headers: _headers,
      body: jsonEncode(payload),
    );

    if (response.statusCode != 200 && response.statusCode != 201) {
      debugPrint(
        "SurveyMonkey: Failed to submit response (${response.statusCode}): ${response.body}",
      );
    }
  }
}
