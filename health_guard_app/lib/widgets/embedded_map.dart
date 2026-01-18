import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

class EmbeddedHospitalMap extends StatefulWidget {
  final double height;

  const EmbeddedHospitalMap({super.key, this.height = 500});

  @override
  State<EmbeddedHospitalMap> createState() => _EmbeddedHospitalMapState();
}

class _EmbeddedHospitalMapState extends State<EmbeddedHospitalMap> {
  // Default location: San Francisco (Union Square approx)
  final center = const LatLng(37.7879, -122.4075);
  final MapController _mapController = MapController();

  final List<Map<String, dynamic>> hospitals = [
    {
      'name': 'Saint Francis Memorial',
      'address': '900 Hyde St, San Francisco',
      'pos': const LatLng(37.7894, -122.4150),
      'distance': '0.5 mi',
      'wait': '15 min wait',
      'color': Colors.green,
    },
    {
      'name': 'SF General Hospital',
      'address': '1001 Potrero Ave, San Francisco',
      'pos': const LatLng(37.7565, -122.4042),
      'distance': '2.4 mi',
      'wait': '45 min wait',
      'color': Colors.orange,
    },
    {
      'name': 'St. Mary\'s Medical Center',
      'address': '450 Stanyan St, San Francisco',
      'pos': const LatLng(37.7739, -122.4505),
      'distance': '3.2 mi',
      'wait': '20 min wait',
      'color': Colors.green,
    },
    {
      'name': 'CPMC Van Ness Campus',
      'address': '1101 Van Ness Ave, San Francisco',
      'pos': const LatLng(37.7856, -122.4214),
      'distance': '1.1 mi',
      'wait': '30 min wait',
      'color': Colors.yellow,
    },
  ];

  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      child: Column(
        children: [
          // Sleek Map View
          Expanded(
            flex: 4,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.1),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  FlutterMap(
                    mapController: _mapController,
                    options: MapOptions(
                      initialCenter: center,
                      initialZoom: 13.5,
                      interactionOptions: const InteractionOptions(
                        flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                      ),
                    ),
                    children: [
                      TileLayer(
                        // CartoDB Positron for a sleek, cleaner, modern look
                        urlTemplate:
                            'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                        subdomains: const ['a', 'b', 'c'],
                        userAgentPackageName: 'com.example.health_guard_app',
                      ),
                      MarkerLayer(
                        markers: hospitals.asMap().entries.map((entry) {
                          final idx = entry.key;
                          final h = entry.value;
                          final isSelected = idx == _selectedIndex;

                          return Marker(
                            point: h['pos'] as LatLng,
                            width: isSelected ? 60 : 40,
                            height: isSelected ? 60 : 40,
                            child: GestureDetector(
                              onTap: () {
                                setState(() => _selectedIndex = idx);
                                _mapController.move(h['pos'] as LatLng, 14.5);
                              },
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 300),
                                decoration: BoxDecoration(
                                  color: isSelected
                                      ? Colors.redAccent
                                      : Colors.redAccent.withOpacity(0.8),
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: Colors.white,
                                    width: isSelected ? 3 : 2,
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      blurRadius: isSelected ? 8 : 4,
                                      color: Colors.black26,
                                    ),
                                  ],
                                ),
                                child: Icon(
                                  Icons.local_hospital,
                                  color: Colors.white,
                                  size: isSelected ? 32 : 20,
                                ),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                      // User Location Marker
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: center,
                            width: 60,
                            height: 60,
                            child: Column(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(6),
                                  decoration: BoxDecoration(
                                    color: Colors.blueAccent,
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: Colors.white,
                                      width: 3,
                                    ),
                                    boxShadow: const [
                                      BoxShadow(
                                        blurRadius: 5,
                                        color: Colors.black26,
                                      ),
                                    ],
                                  ),
                                  child: const Icon(
                                    Icons.person_pin,
                                    color: Colors.white,
                                    size: 24,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  Positioned(
                    bottom: 16,
                    right: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.8),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Text(
                        "© OpenStreetMap, © CartoDB",
                        style: TextStyle(fontSize: 10, color: Colors.black54),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          // Available Locations List
          Expanded(
            flex: 3,
            child: ListView.separated(
              itemCount: hospitals.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final h = hospitals[index];
                final isSelected = index == _selectedIndex;

                return GestureDetector(
                  onTap: () {
                    setState(() => _selectedIndex = index);
                    _mapController.move(h['pos'] as LatLng, 14.5);
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Theme.of(context).primaryColor.withOpacity(0.05)
                          : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected
                            ? Theme.of(context).primaryColor
                            : Colors.grey.shade200,
                        width: isSelected ? 2 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: (h['color'] as Color).withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.local_hospital_rounded,
                            color: h['color'] as Color,
                            size: 20,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                h['name'],
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                h['address'],
                                style: TextStyle(
                                  color: Colors.grey.shade600,
                                  fontSize: 11,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Icon(
                                    Icons.directions_car,
                                    size: 12,
                                    color: Colors.grey.shade600,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    h['distance'],
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: Colors.grey.shade700,
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Icon(
                                    Icons.access_time,
                                    size: 12,
                                    color: Colors.grey.shade600,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    h['wait'],
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: (h['color'] as Color).withOpacity(
                                        0.8,
                                      ),
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          iconSize: 20,
                          icon: const Icon(Icons.directions),
                          onPressed: () => _openMap(h['name'], h['address']),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openMap(String name, String address) async {
    final query = Uri.encodeComponent("$name, $address");
    final uri = Uri.parse(
      "https://www.google.com/maps/search/?api=1&query=$query",
    );
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }
}
