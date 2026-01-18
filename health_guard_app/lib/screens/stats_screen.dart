import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import 'dart:convert';
import 'package:image_picker/image_picker.dart';
import '../models/health_record.dart';
import '../services/storage_service.dart';
import '../services/gemini_service.dart';
import 'doctor_report_screen.dart';

class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key});

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  final StorageService _storageService = StorageService();
  final GeminiService _geminiService = GeminiService();
  final ImagePicker _picker = ImagePicker();

  List<HealthRecord> _records = [];
  List<Medication> _medications = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final records = await _storageService.getRecords();
    final medications = await _storageService.getMedications();
    setState(() {
      _records = records;
      _medications = medications;
      _isLoading = false;
    });
  }

  Future<void> _addRecord(String type) async {
    // Show dialog to add diagnosis, checkup, or blood test
    final titleController = TextEditingController();
    final descController = TextEditingController();

    String dialogTitle = "Add Record";
    String hint = "Details";
    if (type == 'checkup') {
      dialogTitle = "Log Checkup";
      hint = "Outcome/Doctor's Notes";
    } else if (type == 'blood_test') {
      dialogTitle = "Log Blood Test";
      hint = "Results (e.g. Iron: Normal)";
    } else {
      dialogTitle = "Log Diagnosis";
      hint = "Condition/Diagnosis";
    }

    await showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(dialogTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: titleController,
              decoration: const InputDecoration(
                labelText: "Title (e.g. Annual Exam)",
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: descController,
              decoration: InputDecoration(labelText: hint),
              maxLines: 3,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("Cancel"),
          ),
          TextButton(
            onPressed: () async {
              if (titleController.text.isNotEmpty) {
                final newRecord = HealthRecord(
                  id: const Uuid().v4(),
                  title: titleController.text,
                  description: descController.text,
                  date: DateTime.now(),
                  type: type,
                );
                await _storageService.saveRecord(newRecord);
                Navigator.pop(context);
                _loadData();
              }
            },
            child: const Text("Save"),
          ),
        ],
      ),
    );
  }

  Future<void> _addMedication() async {
    final nameController = TextEditingController();
    final dosageController = TextEditingController();
    final freqController = TextEditingController();
    final timeController = TextEditingController();

    await showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Add Medication"),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: "Medication Name"),
              ),
              TextField(
                controller: dosageController,
                decoration: const InputDecoration(
                  labelText: "Dosage (e.g. 50mg)",
                ),
              ),
              TextField(
                controller: freqController,
                decoration: const InputDecoration(
                  labelText: "Frequency (e.g. Daily)",
                ),
              ),
              TextField(
                controller: timeController,
                decoration: const InputDecoration(
                  labelText: "Time (e.g. 8:00 AM)",
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("Cancel"),
          ),
          TextButton(
            onPressed: () async {
              if (nameController.text.isNotEmpty) {
                final newMed = Medication(
                  id: const Uuid().v4(),
                  name: nameController.text,
                  dosage: dosageController.text,
                  frequency: freqController.text,
                  timeOfDay: timeController.text,
                );
                await _storageService.saveMedication(newMed);
                Navigator.pop(context);
                _loadData();
              }
            },
            child: const Text("Save"),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteMedication(String id) async {
    await _storageService.deleteMedication(id);
    _loadData();
  }

  Future<void> _scanDocument() async {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              "Scan Health Document",
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildScanOption(
                  Icons.camera_alt,
                  "Camera",
                  ImageSource.camera,
                ),
                _buildScanOption(
                  Icons.photo_library,
                  "Gallery",
                  ImageSource.gallery,
                ),
              ],
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildScanOption(IconData icon, String label, ImageSource source) {
    return InkWell(
      onTap: () async {
        Navigator.pop(context);
        final XFile? image = await _picker.pickImage(source: source);
        if (image != null) {
          _processImage(image);
        }
      },
      child: Column(
        children: [
          CircleAvatar(
            radius: 30,
            backgroundColor: Theme.of(context).colorScheme.primaryContainer,
            child: Icon(
              icon,
              size: 30,
              color: Theme.of(context).colorScheme.onPrimaryContainer,
            ),
          ),
          const SizedBox(height: 8),
          Text(label),
        ],
      ),
    );
  }

  Future<void> _processImage(XFile image) async {
    setState(() => _isLoading = true);

    // Show snackbar
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Analyzing document... please wait.")),
      );
    }

    try {
      final bytes = await image.readAsBytes();
      final jsonString = await _geminiService.analyzeDocument(bytes);

      // Clean up markdown block if present
      final cleanJson = jsonString
          .replaceAll("```json", "")
          .replaceAll("```", "")
          .trim();
      final data = jsonDecode(cleanJson);

      if (mounted) {
        _showScanResultDialog(data);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text("Failed to analyze: $e")));
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _showScanResultDialog(Map<String, dynamic> data) async {
    final type = data['type'] ?? 'other';
    final title = data['title'] ?? 'Scanned Document';
    final description = data['description'] ?? 'No description extraction.';

    if (type == 'medication') {
      // Handle Prescription Logic
      final details = data['medication_details'];
      final name = details?['name'] ?? title;
      final dosage = details?['dosage'] ?? '';
      final frequency = details?['frequency'] ?? '';
      final time = details?['time_of_day'] ?? '';

      // Show Editing Dialog
      final nameCtrl = TextEditingController(text: name);
      final dosageCtrl = TextEditingController(text: dosage);
      final freqCtrl = TextEditingController(text: frequency);
      final timeCtrl = TextEditingController(text: time);

      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text("Prescription Detected"),
          content: SingleChildScrollView(
            child: Column(
              children: [
                Icon(Icons.medication, size: 48, color: Colors.blue),
                SizedBox(height: 16),
                Text(
                  "We found a prescription for $name. Review and add to schedule?",
                ),
                SizedBox(height: 16),
                TextField(
                  controller: nameCtrl,
                  decoration: InputDecoration(labelText: "Medication Name"),
                ),
                TextField(
                  controller: dosageCtrl,
                  decoration: InputDecoration(labelText: "Dosage"),
                ),
                TextField(
                  controller: freqCtrl,
                  decoration: InputDecoration(labelText: "Frequency"),
                ),
                TextField(
                  controller: timeCtrl,
                  decoration: InputDecoration(labelText: "Time"),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text("Cancel"),
            ),
            FilledButton(
              onPressed: () async {
                final newMed = Medication(
                  id: const Uuid().v4(),
                  name: nameCtrl.text,
                  dosage: dosageCtrl.text,
                  frequency: freqCtrl.text,
                  timeOfDay: timeCtrl.text,
                );
                await _storageService.saveMedication(newMed);
                if (mounted) Navigator.pop(ctx);
                _loadData(); // resfresh list
              },
              child: Text("Add to Schedule"),
            ),
          ],
        ),
      );
      return;
    }

    // Default Logic for Other Records
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text("Found: $title"),
        content: SingleChildScrollView(
          child: ListBody(
            children: [
              Text("Type: $type"),
              const SizedBox(height: 8),
              Text(description),
              if (data['medication_details'] != null) ...[
                const Divider(),
                const Text(
                  "Medication found:",
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                Text("Name: ${data['medication_details']['name']}"),
                Text("Dosage: ${data['medication_details']['dosage']}"),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text("Discard"),
          ),
          FilledButton(
            onPressed: () async {
              if (type == 'medication' && data['medication_details'] != null) {
                final m = data['medication_details'];
                final newMed = Medication(
                  id: const Uuid().v4(),
                  name: m['name'] ?? title,
                  dosage: m['dosage'] ?? '',
                  frequency: m['frequency'] ?? '',
                  timeOfDay: m['time_of_day'] ?? '',
                );
                await _storageService.saveMedication(newMed);
              } else {
                final record = HealthRecord(
                  id: const Uuid().v4(),
                  title: title,
                  description: description,
                  date: DateTime.tryParse(data['date'] ?? '') ?? DateTime.now(),
                  type: type == 'other'
                      ? 'checkup'
                      : type, // Default map other to checkup or similar
                );
                await _storageService.saveRecord(record);
              }
              Navigator.pop(ctx);
              _loadData(); // Refresh info
            },
            child: const Text("Save to Log"),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Stats Screen now acts as body of Home, so we don't need Scaffold unless standalone.
    final colorScheme = Theme.of(context).colorScheme;

    if (_isLoading) return const Center(child: CircularProgressIndicator());

    return RefreshIndicator(
      onRefresh: _loadData,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          16,
          16,
          16,
          80,
        ), // extra padding for FAB
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSummaryCards(),
            const SizedBox(height: 16),
            // Inline Header for Meds
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  "Medication Schedule",
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: colorScheme.onSurface,
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.add_circle, color: colorScheme.primary),
                  onPressed: _addMedication,
                ),
              ],
            ),
            if (_medications.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  "No medications scheduled.",
                  style: TextStyle(
                    fontStyle: FontStyle.italic,
                    color: colorScheme.outline,
                  ),
                ),
              )
            else
              Column(
                children: _medications
                    .map(
                      (med) => Card(
                        elevation: 0,
                        color: colorScheme.surfaceContainerHighest,
                        margin: const EdgeInsets.only(bottom: 8),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: colorScheme.secondaryContainer,
                            child: Icon(
                              Icons.medication,
                              color: colorScheme.onSecondaryContainer,
                            ),
                          ),
                          title: Text(
                            med.name,
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          subtitle: Text(
                            "${med.dosage} • ${med.frequency} @ ${med.timeOfDay}",
                          ),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline, size: 20),
                            onPressed: () => _deleteMedication(med.id),
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),

            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  "Health History",
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: colorScheme.onSurface,
                  ),
                ),
                Row(
                  children: [
                    TextButton.icon(
                      onPressed: _scanDocument,
                      icon: Icon(Icons.document_scanner, size: 18),
                      label: Text("Scan"),
                    ),
                    IconButton(
                      icon: const Icon(Icons.add),
                      onPressed: () => _addRecord('diagnosis'),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            _buildHistoryList(),
          ],
        ),
      ),
    );
  }

  Widget _buildHistoryList() {
    if (_records.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Text(
          "No health records yet. Start a diagnosis or scan a document.",
          style: TextStyle(fontStyle: FontStyle.italic),
        ),
      );
    }
    return Column(
      children: _records
          .map(
            (rec) => Card(
              elevation: 0,
              margin: const EdgeInsets.only(bottom: 8),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
              ),
              child: ListTile(
                leading: _getIconForType(rec.type),
                title: Text(
                  rec.title,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(DateFormat.yMMMd().format(rec.date)),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  // Navigate to the Doctor Report Screen
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => DoctorReportScreen(
                        record: rec,
                        currentMeds: _medications,
                      ),
                    ),
                  );
                },
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _getIconForType(String type) {
    IconData i = Icons.article;
    if (type == 'checkup') i = Icons.medical_services;
    if (type == 'blood_test') i = Icons.water_drop;
    if (type == 'diagnosis') i = Icons.monitor_heart;

    return Icon(i, color: Theme.of(context).colorScheme.primary);
  }

  Widget _buildSummaryCards() {
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: "Records",
            value: _records.length.toString(),
            icon: Icons.history,
            color: Colors.blue,
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: _StatCard(
            label: "Meds",
            value: _medications.length.toString(),
            icon: Icons.medication,
            color: Colors.orange,
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final MaterialColor color;

  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.shade50,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.shade100),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color.shade700),
          const SizedBox(height: 12),
          Text(
            value,
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: color.shade900,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              color: color.shade700,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
