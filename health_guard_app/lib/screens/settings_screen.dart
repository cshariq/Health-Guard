import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/theme_provider.dart';
import '../services/storage_service.dart';
import '../services/gemini_service.dart';
import '../services/surveymonkey_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final StorageService _storageService = StorageService();
  int _checkInInterval = 60; // default

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final interval = await _storageService.getCheckInInterval();
    if (mounted) {
      setState(() {
        _checkInInterval = interval;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final themeProvider = Provider.of<ThemeProvider>(context);

    return Scaffold(
      appBar: AppBar(title: const Text("Settings")),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text("Dark Mode"),
            subtitle: const Text("Enable dark theme for the app"),
            value: themeProvider.isDarkMode,
            onChanged: (val) {
              themeProvider.toggleTheme(val);
            },
          ),
          const Divider(),
          ListTile(
            title: const Text("Safety Check-In Frequency"),
            subtitle: Text("Current: Every $_checkInInterval minutes"),
          ),
          Slider(
            value: _checkInInterval.toDouble(),
            min: 15,
            max: 240,
            divisions: 15, // 15, 30, 45, 60...
            label: "$_checkInInterval min",
            onChanged: (val) {
              setState(() {
                _checkInInterval = val.toInt();
              });
            },
            onChangeEnd: (val) {
              _storageService.setCheckInInterval(val.toInt());
            },
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              "Controls how often your location is automatically updated or how frequently you are reminded to check in.",
              style: TextStyle(color: Colors.grey, fontSize: 12),
            ),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.feedback_outlined, color: Colors.blue),
            title: const Text("Share Feedback"),
            subtitle: const Text(
              "Helping us improve with invisible AI insights.",
            ),
            onTap: _showFeedbackDialog,
          ),
        ],
      ),
    );
  }

  void _showFeedbackDialog() {
    final TextEditingController feedbackCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("How are we doing?"),
        content: TextField(
          controller: feedbackCtrl,
          maxLines: 4,
          decoration: const InputDecoration(
            hintText: "Tell us about your experience...",
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text("Cancel"),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final text = feedbackCtrl.text;
              if (text.isEmpty) return;

              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text("Processing feedback with AI...")),
              );

              // 1. Analyze with Gemini
              final analysis = await GeminiService().analyzeSentiment(text);

              // 2. Submit to SurveyMonkey
              await SurveyMonkeyService().submitFeedback(text, analysis);

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text("Feedback received! Thank you."),
                  ),
                );
              }
            },
            child: const Text("Submit"),
          ),
        ],
      ),
    );
  }
}
