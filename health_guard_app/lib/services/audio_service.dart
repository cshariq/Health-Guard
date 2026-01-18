import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:audioplayers/audioplayers.dart';
import '../config.dart';

class AudioService {
  final String voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel
  final AudioPlayer player = AudioPlayer();

  Future<void> speak(String text) async {
    if (Config.elevenLabsApiKey == 'YOUR_ELEVENLABS_API_KEY') {
      print("ElevenLabs API Key not set. Skipping audio.");
      return;
    }

    try {
      final url = Uri.parse(
        'https://api.elevenlabs.io/v1/text-to-speech/$voiceId',
      );
      final response = await http.post(
        url,
        headers: {
          'xi-api-key': Config.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          "text": text,
          "model_id": "eleven_multilingual_v2",
          "voice_settings": {"stability": 0.5, "similarity_boost": 0.5},
        }),
      );

      if (response.statusCode == 200) {
        final bytes = response.bodyBytes;
        await player.play(BytesSource(bytes));
      } else {
        print("ElevenLabs Error: ${response.body}");
      }
    } catch (e) {
      print("Audio Error: $e");
    }
  }
}
