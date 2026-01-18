import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'base_agent.dart';
import '../services/gemini_service.dart';
import '../services/surveymonkey_service.dart';

class DiagnosisAgent extends BaseAgent {
  final GeminiService _gemini = GeminiService();
  final SurveyMonkeyService _surveyMonkey = SurveyMonkeyService();

  DiagnosisAgent() : super('DiagnosisAgent');

  @override
  void initialize() {
    subscribe('survey/complete', _finalizeDiagnosis);
  }

  Future<void> _finalizeDiagnosis(Map<String, dynamic> payload) async {
    final history = payload['history'];
    debugPrint("[$agentId] Finalizing diagnosis...");

    final prompt =
        """
    You are a Senior Medical Diagnosis Agent.
    Based on this history, provide a final assessment.
    
    History: $history
    
    Return JSON:
    {
       "type": "diagnosis",
       "title": "Condition Name",
       "description": "Detailed explanation (2-3 sentences max).",
       "severity": "Low" | "Moderate" | "High",
       "products": ["Generic Product Name 1", "Generic Product Name 2"],
       "needs_doctor": true/false
    }
    """;

    try {
      // Use generateResponse for stateless agent actions
      final response = await _gemini.generateResponse(prompt);
      final json = jsonDecode(response);

      if (json.containsKey('error')) {
        throw Exception(json['error']);
      }

      publish('medical/diagnosis/final', json);

      // Async: Sync data to SurveyMonkey for clinicial review
      _surveyMonkey.syncSession(
        history: List<String>.from(history),
        diagnosis: json,
      );
    } catch (e) {
      debugPrint("[$agentId] Error: $e");
      publish('medical/diagnosis/final', {
        "title": "Preliminary Assessment",
        "description": "Could not finalize detailed diagnosis due to AI error.",
        "severity": "Moderate",
        "products": [],
        "needs_doctor": true,
      });
    }
  }
}
