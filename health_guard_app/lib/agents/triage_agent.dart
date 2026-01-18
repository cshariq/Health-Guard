import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'base_agent.dart';
import '../services/gemini_service.dart';

class TriageAgent extends BaseAgent {
  final GeminiService _gemini = GeminiService();

  TriageAgent() : super('TriageAgent');

  @override
  void initialize() {
    subscribe('patient/symptom/reported', _handleSymptomReport);
  }

  Future<void> _handleSymptomReport(Map<String, dynamic> payload) async {
    final String symptoms = payload['symptoms'];
    final String conditions = payload['preExistingConditions'] ?? "None";

    debugPrint("[$agentId] Assessing urgency for: $symptoms");

    final prompt =
        """
    You are a Triage Agent.
    User Symptoms: $symptoms
    Pre-existing conditions: $conditions
    
    Determine if this is a LIFE-THREATENING EMERGENCY (Heart attack, stroke, severe bleeding, unconsciousness).
    Return ONLY JSON:
    {
      "isEmergency": true/false,
      "reason": "Short reason"
    }
    """;

    try {
      // Use generateResponse for stateless, prompt-engineered calls
      final response = await _gemini.generateResponse(prompt);
      final json = jsonDecode(response);

      if (json.containsKey('error')) {
        throw Exception(json['error']);
      }

      if (json['isEmergency'] == true) {
        publish('patient/status/emergency', {
          "reason": json['reason'],
          "originalSymptoms": symptoms,
        });
      } else {
        publish('patient/status/stable', {
          "symptoms": symptoms,
          "conditions": conditions,
        });
      }
    } catch (e) {
      debugPrint("[$agentId] Error: $e");
      // Fail safe - assume stable to unblock UI
      publish('patient/status/stable', {"symptoms": symptoms});
    }
  }
}
