import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/location_service.dart';
import '../widgets/accessible_button.dart';
import '../widgets/embedded_map.dart';
import '../services/audio_service.dart';
import 'diagnosis_screen.dart';

class ImmediateScreen extends StatefulWidget {
  const ImmediateScreen({super.key});

  @override
  State<ImmediateScreen> createState() => _ImmediateScreenState();
}

class _ImmediateScreenState extends State<ImmediateScreen> {
  final AudioService _audioService = AudioService();
  bool _hasCalledConfirmation = false;

  @override
  void initState() {
    super.initState();
    _announcePage();
  }

  void _announcePage() {
    _audioService.speak(
      "Emergency Protocol. Have you already called 911 or emergency services?",
    );
  }

  Future<void> _call911() async {
    final Uri launchUri = Uri(scheme: 'tel', path: '911');
    if (await canLaunchUrl(launchUri)) {
      await launchUrl(launchUri);
    }
  }

  void _handleStatusSelection(bool hasCalled) {
    if (hasCalled) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => const DiagnosisScreen(bypassTriage: true),
        ),
      );
    } else {
      setState(() {
        _hasCalledConfirmation = true;
      });
      _audioService.speak(
        "Please call 911 now. A map of nearby hospitals is shown below.",
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    // Phase 1: Confirmation
    if (!_hasCalledConfirmation) {
      return Scaffold(
        backgroundColor: colorScheme.surface,
        appBar: AppBar(leading: BackButton()),
        body: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.contact_phone, size: 64, color: colorScheme.primary),
              const SizedBox(height: 24),
              Text(
                "Have you contacted emergency services?",
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                "If you are already waiting for an ambulance or traveling to the hospital, we can start collecting your health data for the doctors.",
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 48),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  padding: EdgeInsets.all(20),
                  backgroundColor: Colors.green,
                ),
                icon: Icon(Icons.check_circle),
                label: Text("Yes, help is on the way"),
                onPressed: () => _handleStatusSelection(true),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  padding: EdgeInsets.all(20),
                  foregroundColor: colorScheme.error,
                  side: BorderSide(color: colorScheme.error),
                ),
                icon: Icon(Icons.warning),
                label: Text("No, I haven't called yet"),
                onPressed: () => _handleStatusSelection(false),
              ),
            ],
          ),
        ),
      );
    }

    // Phase 2: Action
    return Scaffold(
      appBar: AppBar(title: Text("Emergency Actions")),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Card(
                elevation: 0,
                color: colorScheme.errorContainer,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(32.0),
                  child: Column(
                    children: [
                      Icon(
                        Icons.warning_rounded,
                        size: 80,
                        color: colorScheme.error,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        "CALL 911 NOW",
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                          color: colorScheme.onErrorContainer,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 32),
              AccessibleButton(
                label: "CALL 911",
                icon: Icons.phone_in_talk,
                isEmergency: true,
                onPressed: _call911,
              ),
              const SizedBox(height: 24),
              Text(
                "Nearest Hospitals",
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const EmbeddedHospitalMap(height: 550),
            ],
          ),
        ),
      ),
    );
  }
}
