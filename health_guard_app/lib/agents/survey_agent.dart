import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'base_agent.dart';
import '../services/gemini_service.dart';

class SurveyAgent extends BaseAgent {
  final GeminiService _gemini = GeminiService();
  final List<String> _history = [];

  SurveyAgent() : super('SurveyAgent');

  @override
  void initialize() {
    subscribe('patient/status/stable', _startSurvey);
    subscribe('patient/survey/answer', _continueSurvey);
  }

  Future<void> _startSurvey(Map<String, dynamic> payload) async {
    _history.clear();
    final symptoms = payload['symptoms'];
    _history.add("Patient Symptoms: $symptoms");

    await _generateNextQuestion();
  }

  Future<void> _continueSurvey(Map<String, dynamic> payload) async {
    final answer = payload['answer'];
    _history.add("Patient Answer: $answer");

    // Check if we have enough info (simple logic: 4 turns)
    // In a real agent, the AI would decide if it has enough info.
    if (_history.length > 5) {
      // Initial symptom + 2 Q&A pairs
      publish('survey/complete', {"history": _history});
      return;
    }

    await _generateNextQuestion();
  }

  Future<void> _generateNextQuestion() async {
    debugPrint("[$agentId] Generating next question...");

    final prompt =
        """
    You are a Diagnostic Survey Agent.
    Conversation History: ${_history.join(" | ")}
    
    Task:
    1. If you have enough information to form a diagnosis, return JSON with "type": "diagnosis_ready".
    2. Otherwise, ask ONE clarifying multiple-choice question.
    
    Format:
    {
      "type": "question",
      "text": "The question string",
      "options": ["Option A", "Option B", "Option C"]
    }
    OR
    {
      "type": "diagnosis_ready"
    }
    """;

    try {
      // Use generateResponse for stateless agent calls
      final responseText = await _gemini.generateResponse(prompt);
      final json = jsonDecode(responseText);

      if (json.containsKey('error')) {
        throw Exception(json['error']);
      }

      if (json['type'] == 'diagnosis_ready') {
        publish('survey/complete', {"history": _history});
      } else {
        publish(
          'survey/question/generated',
          json,
        ); // Pass the Q and options to UI
      }
    } catch (e) {
      debugPrint("[$agentId] Error: $e");
      // Fallback: Publish error so UI stops loading
      publish('survey/error', {
        "text": "System Error: Could not generate question. Please try again.",
      });
    }
  }
}
