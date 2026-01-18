import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../models/health_record.dart';
import '../services/solace_service.dart';
import '../widgets/embedded_map.dart';
import '../widgets/product_chip.dart';
import '../services/storage_service.dart';
import '../services/audio_service.dart';
import '../widgets/accessible_button.dart';

class DiagnosisScreen extends StatefulWidget {
  final bool bypassTriage;
  const DiagnosisScreen({super.key, this.bypassTriage = false});

  @override
  State<DiagnosisScreen> createState() => _DiagnosisScreenState();
}

class _DiagnosisScreenState extends State<DiagnosisScreen> {
  final SolaceService _solace = SolaceService();
  final StorageService _storageService = StorageService();
  final AudioService _audioService = AudioService();
  final stt.SpeechToText _speech = stt.SpeechToText();

  final TextEditingController _controller = TextEditingController();
  final List<Message> _messages = [];
  List<String> _currentOptions = []; // Store current MCQ choices
  Map<String, dynamic>? _finalDiagnosis;
  bool _isLoading = false;
  bool _sessionStarted = false;
  bool _isListening = false;

  @override
  void initState() {
    super.initState();
    _connectToMesh();
    _initSpeech();
  }

  void _initSpeech() async {
    await _speech.initialize(
      onError: (val) => print('onError: $val'),
      onStatus: (val) => print('onStatus: $val'),
    );
  }

  void _listen() async {
    if (!_isListening) {
      bool available = await _speech.initialize();
      if (available) {
        setState(() => _isListening = true);
        _speech.listen(
          onResult: (val) {
            setState(() {
              _controller.text = val.recognizedWords;
              if (val.finalResult) {
                _isListening = false;
                _sendText(_controller.text);
              }
            });
          },
        );
      }
    } else {
      setState(() => _isListening = false);
      _speech.stop();
    }
  }

  void _connectToMesh() {
    _solace
        .subscribe('patient/status/#')
        .listen((event) => _handleMeshEvent(event));
    _solace.subscribe('survey/#').listen((event) => _handleMeshEvent(event));
    _solace
        .subscribe('medical/diagnosis/#')
        .listen((event) => _handleMeshEvent(event));
  }

  void _handleMeshEvent(AgentEvent event) {
    if (!mounted) return;

    // Check topic types
    if (event.topic == 'patient/status/emergency') {
      _addMessage("EMERGENCY DETECTED: ${event.payload['reason']}", false);
    } else if (event.topic == 'patient/status/stable') {
      // Triage done, waiting for survey agent...
    } else if (event.topic == 'survey/question/generated') {
      final text = event.payload['text'];
      final options = List<String>.from(event.payload['options']);
      setState(() {
        _isLoading = false;
        _messages.add(Message(text: text, isUser: false));
        _currentOptions = options;
      });
      _audioService.speak(text);
    } else if (event.topic == 'medical/diagnosis/final') {
      final title = event.payload['title'];
      final desc = event.payload['description'];
      // Fallback for fields if older agent version
      final severity = event.payload['severity'] ?? 'Moderate';

      final fullText = "$title\n\n$desc\n\nSeverity: $severity";

      _saveDiagnosis(fullText, title);

      setState(() {
        _isLoading = false;
        _finalDiagnosis = event.payload;
      });
      _audioService.speak("Diagnosis complete. It looks like $title.");
    } else if (event.topic == 'survey/error') {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(event.payload['text'])));
    }
  }

  void _addMessage(String text, bool isUser) {
    setState(() {
      _isLoading = false;
      _messages.add(Message(text: text, isUser: isUser));
      if (!isUser) _currentOptions = []; // Clear options if system message
    });
  }

  Future<void> _startSession() async {
    setState(() {
      _sessionStarted = true;
      _isLoading = false; // We wait for user input first
    });

    _addMessage("Please describe your symptoms in detail.", false);
    _audioService.speak("Please describe your symptoms in detail.");
  }

  Future<void> _sendText(String text) async {
    if (text.isEmpty) return;

    setState(() {
      _messages.add(Message(text: text, isUser: true));
      _isLoading = true;
      _currentOptions = [];
      _controller.clear();
    });

    // Determine what to send based on state.
    // If it's the first message, it's a symptom report.
    // If we are in the middle of a survey, it's an answer.
    // A robust agent system would track session ID. Here we infer.

    if (_messages.length <= 2) {
      // Logic: Initial prompt + User Answer = Symptom Report
      final conditions = await _storageService.getConditions();

      if (widget.bypassTriage) {
        // FAST PATH: Assume stable, go straight to Survey Agent
        // Need to simulate Triage output format for Survey agent
        _solace.publish('patient/status/stable', {
          "symptoms": text,
          "conditions": conditions.join(", "),
        });
      } else {
        // Slow path: Full AI Triage check
        _solace.publish('patient/symptom/reported', {
          "symptoms": text,
          "preExistingConditions": conditions.join(", "),
        });
      }
    } else {
      // Logic: Answering a survey question
      _solace.publish('patient/survey/answer', {"answer": text});
    }
  }

  Future<void> _saveDiagnosis(String fullText, String title) async {
    final record = HealthRecord(
      id: const Uuid().v4(),
      title: title,
      description: fullText,
      date: DateTime.now(),
      type: 'diagnosis',
    );
    await _storageService.saveRecord(record);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("Diagnosis saved: $title"),
          backgroundColor: Colors.teal,
        ),
      );
    }
  }

  Widget _buildFinalReport(ColorScheme colorScheme) {
    final title = _finalDiagnosis!['title'];
    final desc = _finalDiagnosis!['description'];
    final severity = _finalDiagnosis!['severity'] ?? 'Moderate';
    final products = List<String>.from(_finalDiagnosis!['products'] ?? []);
    final needsDoctor = _finalDiagnosis!['needs_doctor'] ?? false;

    Color severityColor = Colors.orange;
    if (severity.toString().toLowerCase() == 'low')
      severityColor = Colors.green;
    if (severity.toString().toLowerCase() == 'high') severityColor = Colors.red;

    return Scaffold(
      backgroundColor: colorScheme.surface, // Clean white/surface
      appBar: AppBar(
        leading: IconButton(
          icon: Icon(Icons.close),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          "Health Report",
          style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18),
        ),
        centerTitle: true,
        actions: [
          IconButton(icon: Icon(Icons.share_outlined), onPressed: () {}),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: severityColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  "$severity Severity",
                  style: TextStyle(
                    color: severityColor,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              title,
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w300, // Modern thin/light weight
                height: 1.2,
                color: colorScheme.onSurface,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            Text(
              "ASSESSMENT",
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.5,
                color: colorScheme.outline,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              desc,
              style: TextStyle(
                fontSize: 16,
                height: 1.6,
                color: colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 32),
            if (products.isNotEmpty) ...[
              Text(
                "RECOMMENDED OTC PRODUCTS",
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.5,
                  color: colorScheme.outline,
                ),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: products.map((prod) {
                  return ProductChip(
                    productName: prod,
                    onOpenDetails: (name, deals) =>
                        _showProductDeals(context, name, deals),
                  );
                }).toList(),
              ),
              const SizedBox(height: 32),
            ],
            if (needsDoctor || severity.toString().toLowerCase() == 'high') ...[
              Container(
                padding: EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: colorScheme.errorContainer.withOpacity(0.4),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Icon(Icons.local_hospital, color: colorScheme.error),
                        SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            "Professional care recommended",
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: colorScheme.onErrorContainer,
                            ),
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 16),
                    Text(
                      "Nearby Emergency Facilities:",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: colorScheme.onErrorContainer,
                      ),
                    ),
                    SizedBox(height: 8),
                    const EmbeddedHospitalMap(height: 400),
                    SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: TextButton.icon(
                        style: TextButton.styleFrom(
                          foregroundColor: colorScheme.onErrorContainer,
                        ),
                        icon: Icon(Icons.open_in_new, size: 16),
                        label: Text("Open in External Maps"),
                        onPressed: _launchMaps,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 40),
            ],

            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  side: BorderSide(color: colorScheme.outline.withOpacity(0.2)),
                ),
                child: Text("Return to Home"),
                onPressed: () => Navigator.pop(context),
              ),
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Future<void> _showProductDeals(
    BuildContext context,
    String query,
    List<Map<String, dynamic>> deals,
  ) async {
    // Categorize
    final inPerson = deals
        .where((d) => (d['type'] ?? 'in_person') == 'in_person')
        .toList();
    final online = deals
        .where((d) => (d['type'] ?? 'in_person') == 'online')
        .toList();

    // Simple logic: cheapest is min price.
    // We'd need to parse float from string "$12.99" to be accurate, but for hackathon assuming mock is fine.

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        height: MediaQuery.of(context).size.height * 0.75,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.travel_explore,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    "Deals for '$query'",
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (deals.isEmpty)
              const Center(child: Text("No deals found via Yellowcake API."))
            else
              Expanded(
                child: ListView(
                  children: [
                    if (inPerson.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Text(
                          "NEARBY STORES",
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: Colors.grey,
                          ),
                        ),
                      ),
                      ...inPerson
                          .map((d) => _buildDealTile(context, d, isLocal: true))
                          .toList(),
                      SizedBox(height: 16),
                    ],
                    if (online.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Text(
                          "ONLINE DELIVERY",
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: Colors.grey,
                          ),
                        ),
                      ),
                      ...online
                          .map(
                            (d) => _buildDealTile(context, d, isLocal: false),
                          )
                          .toList(),
                    ],
                  ],
                ),
              ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.bolt, size: 16, color: Colors.amber),
                const SizedBox(width: 4),
                Text(
                  "Powered by Yellowcake Web Extraction",
                  style: TextStyle(color: Colors.grey, fontSize: 12),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDealTile(
    BuildContext context,
    Map<String, dynamic> deal, {
    required bool isLocal,
  }) {
    final status = deal['status'] ?? '';
    final isOpen = status.toLowerCase().contains('open');

    return Card(
      elevation: 0,
      color: isLocal
          ? Colors.blue.withOpacity(0.05)
          : Colors.orange.withOpacity(0.05),
      margin: EdgeInsets.only(bottom: 8),
      child: ListTile(
        contentPadding: EdgeInsets.all(12),
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            isLocal ? Icons.storefront : Icons.local_shipping,
            color: Colors.black54,
          ),
        ),
        title: Text(
          deal['store'],
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (deal['distance'] != 'Online')
              Text(deal['distance'], style: TextStyle(fontSize: 12)),
            if (status.isNotEmpty)
              Text(
                status,
                style: TextStyle(
                  fontSize: 12,
                  color: isOpen ? Colors.green : Colors.red,
                  fontWeight: FontWeight.w500,
                ),
              ),
            Text(
              deal['availability'],
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              deal['price'],
              style: TextStyle(
                color: Colors.green[800],
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
            Icon(Icons.open_in_new, size: 14, color: Colors.grey),
          ],
        ),
        onTap: () async {
          final uri = Uri.parse(deal['url']);
          if (await canLaunchUrl(uri)) await launchUrl(uri);
        },
      ),
    );
  }

  Future<void> _launchMaps() async {
    final uri = Uri.parse(
      "https://www.google.com/maps/search/hospital+near+me",
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  Widget _getTopicIllustration(String text) {
    IconData icon = Icons.medical_services_outlined;
    Color color = Colors.blue;

    final lowerText = text.toLowerCase();
    if (lowerText.contains('pain') || lowerText.contains('hurt')) {
      icon = Icons.healing;
      color = Colors.red;
    } else if (lowerText.contains('fever') || lowerText.contains('hot')) {
      icon = Icons.thermostat;
      color = Colors.orange;
    } else if (lowerText.contains('stomach') || lowerText.contains('nausea')) {
      icon = Icons.spa;
      color = Colors.green;
    } else if (lowerText.contains('breathing') || lowerText.contains('cough')) {
      icon = Icons.air;
      color = Colors.blueGrey;
    } else if (lowerText.contains('headache')) {
      icon = Icons.psychology;
      color = Colors.purple;
    } else if (lowerText.contains('emergency') || lowerText.contains('call')) {
      icon = Icons.warning_amber_rounded;
      color = Colors.redAccent;
    }

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: 48, color: color),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    if (!_sessionStarted) {
      return Scaffold(
        body: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [colorScheme.surface, colorScheme.surfaceContainer],
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // SurveyMonkey Competition Branding (Mock)
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.check_circle_outline,
                      color: Colors.green,
                      size: 28,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      "POWERED BY SURVEYMONKEY",
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.2,
                        color: Colors.green[700],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 48),
                Icon(
                  Icons.medical_information,
                  size: 80,
                  color: colorScheme.primary,
                ),
                const SizedBox(height: 24),
                Text(
                  "Intelligent Diagnosis",
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: colorScheme.onSurface,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  "Experience the future of health feedback.\n\nOur AI-driven dynamic survey engine instantly adapts to your inputs, making static medical forms obsolete.",
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 16,
                    color: colorScheme.onSurfaceVariant,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 48),
                AccessibleButton(
                  label: "Start Dynamic Survey",
                  icon: Icons.play_arrow_rounded,
                  onPressed: _startSession,
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (_finalDiagnosis != null) {
      return _buildFinalReport(colorScheme);
    }

    final currentMessage = _messages.isNotEmpty
        ? _messages.last
        : Message(text: "Initializing...", isUser: false);

    // If the last message was user (waiting for AI), show loading
    final bool showingLoading =
        _isLoading || (currentMessage.isUser && _messages.isNotEmpty);
    // If we are showing a question from AI
    final bool showQuestion = !showingLoading && !currentMessage.isUser;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(Icons.health_and_safety, color: colorScheme.primary),
            const SizedBox(width: 8),
            const Text("SurveyMonkey Health"),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4.0),
          child: LinearProgressIndicator(
            // Fake progress based on message count/depth
            value: (_messages.length / 10).clamp(0.1, 1.0),
            backgroundColor: colorScheme.surfaceContainerHighest,
            valueColor: AlwaysStoppedAnimation<Color>(Colors.green),
          ),
        ),
      ),
      body: Column(
        children: [
          // Dynamic Confidence/Gamification Badge
          Container(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
            color: colorScheme.secondaryContainer.withOpacity(0.3),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  "Diagnosis Progress",
                  style: TextStyle(
                    color: colorScheme.onSecondaryContainer,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  "${((_messages.length / 10) * 100).clamp(0, 100).toInt()}%",
                  style: TextStyle(
                    color: Colors.green[700],
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),

          Expanded(
            child: showingLoading
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        CircularProgressIndicator(),
                        const SizedBox(height: 16),
                        Text(
                          "Analyzing Response...",
                          style: TextStyle(
                            color: colorScheme.outline,
                            fontSize: 16,
                          ),
                        ),
                      ],
                    ),
                  )
                : SingleChildScrollView(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (showQuestion) ...[
                            // Question Card
                            Card(
                              elevation: 0,
                              color: colorScheme.surfaceContainerHighest,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(24),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(32.0),
                                child: Column(
                                  children: [
                                    _getTopicIllustration(currentMessage.text),
                                    const SizedBox(height: 16),
                                    Text(
                                      currentMessage.text,
                                      style: Theme.of(context)
                                          .textTheme
                                          .headlineSmall
                                          ?.copyWith(
                                            height: 1.4,
                                            fontWeight: FontWeight.w600,
                                          ),
                                      textAlign: TextAlign.center,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 32),

                            // Dynamic Options (Invisible Form)
                            if (_currentOptions.isNotEmpty)
                              ..._currentOptions.map((option) {
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 12.0),
                                  child: SizedBox(
                                    height: 56, // Modern tall touch targets
                                    child: OutlinedButton(
                                      style: OutlinedButton.styleFrom(
                                        side: BorderSide(
                                          color: colorScheme.outline
                                              .withOpacity(0.3),
                                        ),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            16,
                                          ), // Rounded modern look
                                        ),
                                      ),
                                      onPressed: () => _sendText(option),
                                      child: Text(
                                        option,
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              }).toList()
                            else
                              // Fallback if no options (Open ended input)
                              Column(
                                children: [
                                  TextField(
                                    controller: _controller,
                                    decoration: InputDecoration(
                                      hintText: "Type your answer...",
                                      border: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(16),
                                      ),
                                      filled: true,
                                      fillColor: colorScheme.surface,
                                      suffixIcon: IconButton(
                                        icon: Icon(
                                          _isListening
                                              ? Icons.mic
                                              : Icons.mic_none,
                                        ),
                                        color: _isListening
                                            ? Colors.red
                                            : colorScheme.primary,
                                        onPressed: _listen,
                                      ),
                                    ),
                                    maxLines: 3,
                                  ),
                                  const SizedBox(height: 16),
                                  AccessibleButton(
                                    label: "Submit Answer",
                                    icon: Icons.send_rounded,
                                    onPressed: () =>
                                        _sendText(_controller.text),
                                  ),
                                ],
                              ),
                          ],
                        ],
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class Message {
  final String text;
  final bool isUser;
  Message({required this.text, required this.isUser});
}
