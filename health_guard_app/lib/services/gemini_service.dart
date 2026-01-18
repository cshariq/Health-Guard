import 'package:google_generative_ai/google_generative_ai.dart';
import 'dart:typed_data';
import 'dart:convert';
import '../config.dart';

class GeminiService {
  GenerativeModel? model;
  GenerativeModel? visionModel;
  ChatSession? chat;

  GeminiService() {
    if (Config.geminiApiKey != 'YOUR_GEMINI_API_KEY') {
      model = GenerativeModel(
        model: 'gemini-2.5-flash-lite',
        apiKey: Config.geminiApiKey,
      );
      visionModel = GenerativeModel(
        model: 'gemini-2.5-flash-lite',
        apiKey: Config.geminiApiKey,
      );
    }
  }

  Future<String> analyzeDocument(Uint8List imageBytes) async {
    if (visionModel == null) return "Error: API Key missing";

    final prompt = TextPart("""
Analyze this image. It is likely a medical document (prescription, appointment email, lab result, or diagnosis).
Extract the information and return a purely JSON object (no markdown formatting) with this schema:
{
  "type": "medication" | "checkup" | "blood_test" | "diagnosis" | "other",
  "title": "Short concise title (e.g. 'Amoxicillin Prescription' or 'Annual Physical')",
  "description": "A summarized description of the findings or instructions.",
  "date": "YYYY-MM-DD (use today's date if not found in doc)",
  "medication_details": {
     "name": "Medicine Name",
     "dosage": "e.g. 500mg",
     "frequency": "e.g. Daily",
     "time_of_day": "e.g. Morning"
  } 
}
If it is a medication, fill 'medication_details'. If not, set 'medication_details' to null.
Ensure the 'type' maps to one of the options.
""");

    final imagePart = DataPart('image/jpeg', imageBytes);

    try {
      final response = await visionModel!.generateContent([
        Content.multi([prompt, imagePart]),
      ]);
      return response.text ?? "Error: No response from AI";
    } catch (e) {
      return "Error parsing document: $e";
    }
  }

  void startNewDiagnosis(String? preExistingConditions) {
    if (model == null) return;

    String prompt =
        '''
You are a preliminary medical diagnosis assistant.
Your goal is to help a user narrow down their health condition based on symptoms.
The user has the following pre-existing conditions: ${preExistingConditions ?? "None"}.

Protocol:
1. If the user indicates a life-threatening emergency (heart attack signs, stroke, severe bleeding, difficulty breathing, unconsciousness), return ONLY this JSON: {"type": "emergency", "text": "Call 911 immediately. [Reason]"}
2. If it is NOT an emergency, ask ONE clarifying question to narrow down the possibilities.
3. You MUST provide 3-5 multiple choice options for the user to choose from.
4. Return your response in this STRICT JSON format:
   {"type": "question", "text": "The question string", "options": ["Option A", "Option B", "Option C"]}
5. If after 3-5 questions you have a diagnosis, return:
   {"type": "diagnosis", "title": "Condition Name", "description": "Full explanation", "advice": "What to do"}

Do not include markdown formatting like ```json ... ```. Just the raw JSON string.
Now, wait for the user to describe their initial symptoms.
''';

    chat = model!.startChat(history: [Content.text(prompt)]);
  }

  Future<String> sendMessage(String message) async {
    if (model == null)
      return "{\"type\": \"error\", \"text\": \"Gemini API Key missing\"}";

    // If chat is null, we assume this is a stateful chat session.
    // However, for agents that provide their own full prompt context,
    // we should really use generateContent directly if we don't want history.
    if (chat == null) {
      startNewDiagnosis(null);
    }

    try {
      final response = await chat!.sendMessage(Content.text(message));
      return _cleanResponse(response.text);
    } catch (e) {
      return "{\"type\": \"error\", \"text\": \"Error communicating with AI: $e\"}";
    }
  }

  /// Stateless generation for Agents
  Future<String> generateResponse(String prompt) async {
    if (model == null) return "Error: API Key missing";

    try {
      final response = await model!.generateContent([Content.text(prompt)]);
      return _cleanResponse(response.text);
    } catch (e) {
      // Return a valid JSON error so agents don't crash on jsonDecode
      return '{"error": "${e.toString().replaceAll('"', "'")}"}';
    }
  }

  /// Analyzing Feedback Sentiment for SurveyMonkey Integration
  Future<Map<String, dynamic>> analyzeSentiment(String text) async {
    if (model == null) return {"sentiment": "neutral", "keywords": []};

    final prompt =
        """
      Analyze this user feedback for a health app.
      Feedback: "$text"
      
      Return JSON only:
      {
        "sentiment": "Positive" | "Neutral" | "Negative",
        "keywords": ["tag1", "tag2"],
        "summary": "One sentence summary"
      }
    """;

    try {
      final response = await model!.generateContent([Content.text(prompt)]);
      final clean = _cleanResponse(response.text);
      return jsonDecode(clean);
    } catch (e) {
      return {"sentiment": "neutral", "keywords": [], "summary": text};
    }
  }

  String _cleanResponse(String? text) {
    if (text == null) return "{}";
    String clean = text;
    // Remove markdown code blocks
    if (clean.contains("```json")) {
      clean = clean.replaceAll("```json", "").replaceAll("```", "");
    } else if (clean.contains("```")) {
      clean = clean.replaceAll("```", "");
    }
    return clean.trim();
  }
}
