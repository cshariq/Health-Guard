import 'package:flutter/material.dart';
import '../services/storage_service.dart';
import '../widgets/accessible_button.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final StorageService _storageService = StorageService();
  final TextEditingController _controller = TextEditingController();
  List<String> _conditions = [];

  @override
  void initState() {
    super.initState();
    _loadConditions();
  }

  Future<void> _loadConditions() async {
    final conditions = await _storageService.getConditions();
    setState(() {
      _conditions = conditions;
    });
  }

  Future<void> _addCondition() async {
    if (_controller.text.isNotEmpty) {
      await _storageService.saveCondition(_controller.text);
      _controller.clear();
      await _loadConditions();
    }
  }

  Future<void> _removeCondition(String condition) async {
    await _storageService.removeCondition(condition);
    await _loadConditions();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text("My Health Profile")),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            Card(
              elevation: 0,
              color: colorScheme.primaryContainer.withOpacity(0.4),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, color: colorScheme.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        "Saved conditions help our AI give better advice.",
                        style: TextStyle(color: colorScheme.onSurfaceVariant),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _controller,
              style: const TextStyle(fontSize: 16),
              decoration: InputDecoration(
                labelText: "Condition Name (e.g. Diabetes)",
                filled: true,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none,
                ),
                prefixIcon: const Icon(Icons.add_circle_outline),
              ),
            ),
            const SizedBox(height: 16),
            AccessibleButton(
              label: "Add Condition",
              onPressed: _addCondition,
              icon: Icons.save_alt,
            ),
            const SizedBox(height: 32),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                "Your Conditions",
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: _conditions.isEmpty
                  ? Center(
                      child: Text(
                        "No conditions saved yet.",
                        style: TextStyle(color: colorScheme.outline),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _conditions.length,
                      itemBuilder: (context, index) {
                        return Card(
                          elevation: 0,
                          color: colorScheme.surfaceContainer,
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 20,
                              vertical: 8,
                            ),
                            title: Text(
                              _conditions[index],
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            trailing: IconButton.filledTonal(
                              icon: const Icon(Icons.delete_outline),
                              color: colorScheme.error,
                              onPressed: () =>
                                  _removeCondition(_conditions[index]),
                              tooltip: "Delete ${_conditions[index]}",
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
