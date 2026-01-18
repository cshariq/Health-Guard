import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/check_in.dart';
import '../services/storage_service.dart';
import '../services/surveymonkey_service.dart';
import '../services/solace_service.dart';
import 'diagnosis_screen.dart';
import 'immediate_screen.dart';

class SafetyScreen extends StatefulWidget {
  const SafetyScreen({super.key});

  @override
  State<SafetyScreen> createState() => _SafetyScreenState();
}

class _SafetyScreenState extends State<SafetyScreen> {
  final StorageService _storageService = StorageService();
  final SolaceService _solace = SolaceService();
  List<CheckIn> _checkIns = [];
  bool _isLoading = true;
  final MapController _mapController = MapController();

  // NYC Area Center
  final LatLng _center = const LatLng(40.7128, -74.0060); // Lower Manhattan

  // Mock Family Members for Demo with positions relative to center
  final List<CheckIn> _familyCheckIns = [
    CheckIn(
      id: 'mom-1',
      timestamp: DateTime.now().subtract(const Duration(minutes: 45)),
      latitude: 40.7200,
      longitude: -74.0100,
      locationName: "Work",
      userName: "Mom",
    ),
    CheckIn(
      id: 'dad-1',
      timestamp: DateTime.now().subtract(const Duration(hours: 2)),
      latitude: 40.7050,
      longitude: -73.9900,
      locationName: "Gym",
      userName: "Dad",
    ),
  ];

  @override
  void initState() {
    super.initState();
    _loadCheckIns();
  }

  Future<void> _loadCheckIns() async {
    setState(() => _isLoading = true);
    final userCheckIns = await _storageService.getCheckIns();

    // Merge user check-ins with mock family check-ins
    final allCheckIns = [...userCheckIns, ..._familyCheckIns];
    allCheckIns.sort((a, b) => b.timestamp.compareTo(a.timestamp));

    if (mounted) {
      setState(() {
        _checkIns = allCheckIns;
        _isLoading = false;
      });
    }
  }

  Future<void> _performCheckIn({
    bool isAlert = false,
    bool skipDialog = false,
  }) async {
    // 1. Check Rate Limit (unless it's an emergency)
    if (!isAlert) {
      final intervalMinutes = await _storageService.getCheckInInterval();
      final lastMe = _checkIns
          .where((c) => c.userName == "Me")
          .firstOrNull; // Since list is sorted desc

      if (lastMe != null) {
        final diff = DateTime.now().difference(lastMe.timestamp).inMinutes;
        if (diff < intervalMinutes) {
          final remaining = intervalMinutes - diff;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                "Next scheduled check-in in $remaining min. Emergency? Use SOS.",
              ),
              behavior: SnackBarBehavior.floating,
              backgroundColor: Colors.grey.shade800,
            ),
          );
          return; // Block check-in
        }
      }
    } else if (!skipDialog) {
      // SOS Dialog Logic
      await _handleSOS();
      return; // HandleSOS will call performCheckIn(isAlert:true, skipDialog:true) if needed
    }

    // Show quick feedback immediately
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          isAlert ? "Sending Emergency Alert..." : "Updating location...",
        ),
        duration: const Duration(milliseconds: 1500),
        behavior: SnackBarBehavior.floating,
        backgroundColor: isAlert ? Colors.red : null,
      ),
    );

    // Add some random jitter to simulate movement around the center
    final rndLat =
        _center.latitude + (DateTime.now().millisecond % 100) / 10000;
    final rndLng =
        _center.longitude + (DateTime.now().millisecond % 100) / 10000;

    final newCheckIn = CheckIn(
      id: const Uuid().v4(),
      timestamp: DateTime.now(),
      latitude: rndLat,
      longitude: rndLng,
      locationName: isAlert ? "Emergency Location" : "Current Location",
      userName: "Me",
      isAlert: isAlert,
    );

    await _storageService.saveCheckIn(newCheckIn);

    // 1. Publish to Solace Mesh (Local/Remote)
    _solace.publish('family/checkin', newCheckIn.toMap());

    // 2. Log to SurveyMonkey (Invisible Compliance Log)
    // This turns a "button approach" into a "survey response" effortlessly.
    SurveyMonkeyService().logSafetyCheck(
      newCheckIn.userName,
      newCheckIn.locationName,
      isAlert ? "Emergency" : "Safe",
    );

    if (mounted) {
      _loadCheckIns();
      // Animate map to new location if controller is ready
      try {
        _mapController.move(LatLng(rndLat, rndLng), 15);
      } catch (e) {
        // ignore
      }

      // If it was an alert, we handled the navigation inside _handleSOS for Critical cases,
      // but for non-critical alerts (User said "No, check symptoms"), we should navigate here.
      // Wait, _handleSOS calls _performCheckIn(isAlert:true, skipDialog:true).
      // So checking here is fine, but we need to distinguish scenarios.
      // Maybe simpler to do navigation inside _handleSOS completely?
      // Or set a flag?
      // Actually, _handleSOS has specific logic for Critical vs Non-Critical navigation.
      // I will remove the navigation logic from here and put it in _handleSOS.
      // EXCEPT: if _performCheckIn is called directly without check, we might miss nav.
      // But _performCheckIn is only called by UI.
    }
  }

  Future<void> _handleSOS() async {
    // 1. Show Critical Check Dialog using a modern BottomSheet or Dialog
    final isCritical = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.warning, color: Colors.red),
            SizedBox(width: 8),
            Text("Emergency Status"),
          ],
        ),
        content: const Text("Is this a critical, life-threatening situation?"),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text("No, Just Symptoms"),
          ),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            icon: const Icon(Icons.emergency),
            label: const Text("Yes, Critical"),
          ),
        ],
      ),
    );

    if (isCritical == null) return; // Dismissed

    if (isCritical) {
      // 2. Ask about 911
      final calledServices = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text("Emergency Services"),
          content: const Text(
            "Have you called 911 (or local emergency services)?",
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text("No, Call Now"),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text("Yes, I Called"),
            ),
          ],
        ),
      );

      if (calledServices == false) {
        // Launch Dialer
        final Uri launchUri = Uri(scheme: 'tel', path: '911');
        if (await canLaunchUrl(launchUri)) {
          await launchUrl(launchUri);
        }
      }

      // Log SOS and navigate to Immediate Support Screen (which handles CPR steps etc)
      await _performCheckIn(isAlert: true, skipDialog: true);
      if (mounted) {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const ImmediateScreen()),
        );
      }
    } else {
      // Not critical
      await _performCheckIn(isAlert: true, skipDialog: true);
      if (mounted) {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => const DiagnosisScreen(bypassTriage: true),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    // Identify latest checkin for each user to show markers
    final Map<String, CheckIn> latestPositions = {};
    for (var c in _checkIns) {
      if (!latestPositions.containsKey(c.userName)) {
        latestPositions[c.userName] = c;
      }
    }

    return Scaffold(
      body: Stack(
        children: [
          // 1. Full Screen Map
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(initialCenter: _center, initialZoom: 13.5),
            children: [
              TileLayer(
                urlTemplate:
                    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
                subdomains: const ['a', 'b', 'c', 'd'],
              ),
              MarkerLayer(
                markers: latestPositions.values.map((c) {
                  final isMe = c.userName == "Me";
                  final isAlert = c.isAlert;
                  return Marker(
                    point: LatLng(c.latitude, c.longitude),
                    width: 70,
                    height: 75,
                    child: Column(
                      mainAxisSize:
                          MainAxisSize.min, // Ensure it takes min space
                      children: [
                        Container(
                          decoration: BoxDecoration(
                            color: isAlert
                                ? Colors.red
                                : (isMe ? Colors.blue : Colors.orange),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 3),
                            boxShadow: const [
                              BoxShadow(
                                color: Colors.black26,
                                blurRadius: 4,
                                offset: Offset(0, 2),
                              ),
                            ],
                          ),
                          padding: const EdgeInsets.all(8),
                          child: Icon(
                            isAlert
                                ? Icons.warning_amber_rounded
                                : Icons.person,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                        // Label
                        Container(
                          margin: const EdgeInsets.only(top: 2),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 4,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.8),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            c.userName,
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ],
          ),

          // 3. Bottom Sheet (Modern Sliding Panel Look)
          DraggableScrollableSheet(
            initialChildSize: 0.45,
            minChildSize: 0.25,
            maxChildSize: 0.85,
            builder: (context, scrollController) {
              return Container(
                decoration: BoxDecoration(
                  color: Theme.of(context).cardColor,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(24),
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Colors.black12,
                      blurRadius: 20,
                      spreadRadius: 5,
                      offset: Offset(0, -4),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    // Handle
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: Container(
                        width: 40,
                        height: 5,
                        decoration: BoxDecoration(
                          color: Colors.grey.shade300,
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),

                    // Quick Actions
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24.0),
                      child: Row(
                        children: [
                          Expanded(
                            child: _buildActionButton(
                              context,
                              label: "I'm Safe",
                              subLabel: "Check In",
                              color: Colors.green,
                              icon: Icons.check_circle_outline,
                              onTap: () => _performCheckIn(isAlert: false),
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: _buildActionButton(
                              context,
                              label: "SOS",
                              subLabel: "Emergency",
                              color: Colors.red,
                              icon: Icons.sos,
                              onTap: () => _performCheckIn(isAlert: true),
                              isPulse: true,
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          "TIMELINE",
                          style: TextStyle(
                            color: Colors.grey.shade500,
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                            letterSpacing: 1.2,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),

                    // The List
                    Expanded(
                      child: ListView.builder(
                        // changed from separated to builder
                        controller: scrollController,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        itemCount: _checkIns.length,
                        // No separator needed for continuous timeline look
                        itemBuilder: (context, index) {
                          final item = _checkIns[index];
                          return _buildTimelineRow(context, item);
                        },
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton(
    BuildContext context, {
    required String label,
    required String subLabel,
    required Color color,
    required IconData icon,
    required VoidCallback onTap,
    bool isPulse = false,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        height: 80,
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withOpacity(0.2)),
        ),
        padding: const EdgeInsets.all(12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                boxShadow: isPulse
                    ? [
                        BoxShadow(
                          color: color.withOpacity(0.4),
                          blurRadius: 10,
                          spreadRadius: 2,
                        ),
                      ]
                    : [],
              ),
              child: Icon(icon, color: Colors.white, size: 24),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: color,
                    ),
                  ),
                  Text(
                    subLabel,
                    style: TextStyle(
                      color: color.withOpacity(0.8),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTimelineRow(BuildContext context, CheckIn item) {
    final isAlert = item.isAlert;
    final timeStr = DateFormat('h:mm a').format(item.timestamp);
    final isMe = item.userName == "Me";
    final color = isAlert ? Colors.red : (isMe ? Colors.blue : Colors.orange);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Minimal Time Column
          SizedBox(
            width: 50,
            child: Text(
              timeStr,
              style: TextStyle(
                color: Colors.grey.shade500,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
              textAlign: TextAlign.right,
            ),
          ),
          const SizedBox(width: 12),

          // Timeline Line & Dot
          Column(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                  boxShadow: [
                    BoxShadow(color: color.withOpacity(0.3), blurRadius: 4),
                  ],
                ),
              ),
              Expanded(child: Container(width: 1, color: Colors.grey.shade200)),
            ],
          ),
          const SizedBox(width: 12),

          // Content
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.userName,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: color,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    isAlert
                        ? "SOS Alert at ${item.locationName}"
                        : "Checked in at ${item.locationName}",
                    style: TextStyle(
                      color: isAlert
                          ? Colors.red.shade700
                          : Theme.of(context).textTheme.bodyMedium?.color,
                      fontWeight: isAlert ? FontWeight.w600 : FontWeight.normal,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
