import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config.dart';

class YellowcakeService {
  static final YellowcakeService _instance = YellowcakeService._internal();
  factory YellowcakeService() => _instance;
  YellowcakeService._internal();

  // TODO: Replace with actual Yellowcake API URL provided by challenge organizers
  // If this is a local hackathon API, ensure the device is on the same network
  final String _baseUrl = Config.yellowcakeBaseUrl;

  /// Searches for real-world deals and availability for a medical product
  /// using the Yellowcake Web Extraction API.
  Future<List<Map<String, dynamic>>> findProductDeals(
    String productName,
  ) async {
    // 1. Check for valid configuration
    if (Config.yellowcakeApiKey.contains('YOUR_') || Config.yellowcakeApiKey.isEmpty) {
      print('⚠️ [Yellowcake] No API Key. Using Offline Simulation.');
      await Future.delayed(const Duration(seconds: 1));
      return _getMockDeals(productName);
    }
    
    print('🚀 [Yellowcake] Connecting to Extraction Grid: $_baseUrl');
    print('🚀 [Yellowcake] Querying: $productName');

    try {
      // Canadian Retailers to scrape
      final targets = [
        {
          'name': 'Walmart Canada',
          'url': 'https://www.walmart.ca/search?q=${Uri.encodeComponent(productName)}',
          'prompt': 'Extract product cards. Return "title", "price", and "availability".',
        },
        {
          'name': 'Amazon Canada',
          'url': 'https://www.amazon.ca/s?k=${Uri.encodeComponent(productName)}',
          'prompt': 'Extract search results. Return "title", "price", "delivery_date".',
        },
        {
          'name': 'Shoppers Drug Mart',
          'url': 'https://shop.shoppersdrugmart.ca/shop/search?search=${Uri.encodeComponent(productName)}',
          'prompt': 'Extract product list. Return "title", "price".',
        }
      ];

      List<Map<String, dynamic>> allDeals = [];

      // Sequential scraping to avoid overwhelming API or client
      print('🚀 [Yellowcake] Launching Distributed Scraping Job...');
      
      for (final target in targets) {
        final extracted = await _extractFromSource(
          target['url']!, 
          target['prompt']!, 
          target['name']!, 
          productName
        );
        allDeals.addAll(extracted);
      }

      if (allDeals.isNotEmpty) {
        return allDeals;
      }
      
      print('ℹ️ [Yellowcake] All extractions yielded 0 results. Switching to Offline Simulation.');
      return _getMockDeals(productName);

    } catch (e) {
      print('⚠️ [Yellowcake] Connection Failed: $e');
      return _getMockDeals(productName);
    }
  }

  Future<List<Map<String, dynamic>>> _extractFromSource(
      String targetUrl, String prompt, String storeName, String query) async {
    try {
      print('⚡ [Yellowcake] Scraping $storeName...');
      final response = await http.post(
        Uri.parse('$_baseUrl/extract-stream'),
        headers: {
          'X-API-Key': Config.yellowcakeApiKey,
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'url': targetUrl,
          'prompt': prompt,
        }),
      );

      if (response.statusCode == 200) {
        final lines = response.body.split('\n');
        for (final line in lines) {
          if (line.trim().isEmpty) continue;
          if (line.startsWith('data: {')) {
            final jsonStr = line.substring(6);
            final parsed = jsonDecode(jsonStr);
            if (parsed['success'] == true && parsed['data'] is List) {
              final rawResults = parsed['data'] as List;
              if (rawResults.isNotEmpty) {
                print('   ✅ Found ${rawResults.length} items from $storeName');
                return rawResults.take(3).map<Map<String, dynamic>>((item) => {
                  'store': storeName,
                  'price': item['price'] ?? item['product_price'] ?? 'See Site',
                  'availability': item['availability'] ?? 'In Stock',
                  'distance': storeName.contains('Amazon') ? 'Online' : '1.5 km',
                  'status': 'Open Now',
                  'type': storeName.contains('Amazon') ? 'online' : 'in_person',
                  'url': targetUrl,
                  'title': item['title'] ?? item['product_title'] ?? query
                }).toList();
              }
            }
          }
        }
      }
    } catch (e) {
      print('   ❌ Error scraping $storeName: $e');
    }
    return [];
  }

  // PREVIOUS IMPLEMENTATION (Commented out until API endpoint is live)
  /*
  Future<List<Map<String, dynamic>>> _findProductDealsReal(
    String productName,
  ) async {
    // Demo Mode: If no API key is set, return simulated "scraped" data
    if (Config.yellowcakeApiKey.contains('YOUR_') ||
        Config.yellowcakeApiKey.isEmpty) {
      print(
        '⚠️ [Yellowcake] No API Key found in Config. Using MOCK data for demo.',
      );
      // Simulate network latency
      await Future.delayed(const Duration(seconds: 1));
      return _getMockDeals(productName);
    }

    print('🚀 [Yellowcake] Fetching LIVE data for: $productName');

    try {
      // Hypothetical Yellowcake Search/Extract Endpoint
      final response = await http.post(
        Uri.parse('$_baseUrl/extract'),
        headers: {
          'Authorization': 'Bearer ${Config.yellowcakeApiKey}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'query': '$productName price availability near me',
          'sources': ['cvs.com', 'walgreens.com', 'amazon.com'],
          'extract_fields': ['title', 'price', 'availability', 'url'],
        }),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        // Adaptation layer: Convert API response to our app's format
        // Assuming API returns { "results": [...] }
        return List<Map<String, dynamic>>.from(data['results']);
      } else {
        print(
          'Yellowcake API inaccessible (HTTP ${response.statusCode}). Using Offline Demo Mode.',
        );
        return _getMockDeals(productName); // Fallback to mock on error
      }
    } catch (e) {
      print('Yellowcake Connection Error: $e. Using Offline Demo Mode.');
      return _getMockDeals(productName); // Fallback to mock on exception
    }
  }
  */

  /// Extracts health information from a specific URL if the user provides one
  Future<Map<String, dynamic>> analyzeUrl(String url) async {
    if (Config.yellowcakeApiKey.isEmpty ||
        Config.yellowcakeApiKey.contains('YOUR_')) {
      await Future.delayed(const Duration(seconds: 1));
      return {
        'summary':
            'Analyzed content from $url. Contains medical advice regarding flu symptoms.',
        'safety_score': 85,
      };
    }

    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/parse'),
        headers: {
          'Authorization': 'Bearer ${Config.yellowcakeApiKey}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'url': url}),
      );

      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      print(e);
    }
    return {'error': 'Failed to analyze'};
  }

  List<Map<String, dynamic>> _getMockDeals(String query) {
    return [
      {
        'store': 'CVS Pharmacy',
        'price': '\$12.99',
        'availability': 'In Stock',
        'distance': '0.8 miles',
        'status': 'Open • Closes 10PM',
        'type': 'in_person',
        'url': 'https://www.cvs.com/search?q=$query',
      },
      {
        'store': 'Walgreens',
        'price': '\$11.49',
        'availability': 'Low Stock',
        'distance': '1.2 miles',
        'status': 'Open 24 Hours',
        'type': 'in_person',
        'url': 'https://www.walgreens.com/search/results.jsp?Ntt=$query',
      },
      {
        'store': 'Rite Aid',
        'price': '\$13.49',
        'availability': 'In Stock',
        'distance': '2.5 miles',
        'status': 'Closed • Opens 8AM',
        'type': 'in_person',
        'url': 'https://www.riteaid.com/shop/search?q=$query',
      },
      {
        'store': 'Amazon (Prime)',
        'price': '\$9.99',
        'availability': 'Next Day Delivery',
        'distance': 'Online',
        'status': 'Always Open',
        'type': 'online',
        'url': 'https://www.amazon.com/s?k=$query',
      },
    ];
  }
}
