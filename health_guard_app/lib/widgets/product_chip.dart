import 'package:flutter/material.dart';
import '../services/yellowcake_service.dart';

class ProductChip extends StatefulWidget {
  final String productName;
  final Function(String name, List<Map<String, dynamic>> deals) onOpenDetails;

  const ProductChip({
    super.key,
    required this.productName,
    required this.onOpenDetails,
  });

  @override
  State<ProductChip> createState() => _ProductChipState();
}

class _ProductChipState extends State<ProductChip> {
  List<Map<String, dynamic>>? _deals;
  String? _bestPrice;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _fetchDeals();
  }

  Future<void> _fetchDeals() async {
    final deals = await YellowcakeService().findProductDeals(
      widget.productName,
    );
    if (!mounted) return;

    String? lowest;
    if (deals.isNotEmpty) {
      // Simple parsing: "$12.99" -> 12.99
      // We will just display the string of the first one or logic to find min
      // For now, let's just pick the first one's price as a preview
      lowest = deals.first['price'];
    }

    setState(() {
      _deals = deals;
      _bestPrice = lowest;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    String label = widget.productName;
    if (_bestPrice != null) {
      label += " • $_bestPrice";
    }

    return ActionChip(
      avatar: _loading
          ? SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(
              Icons.shopping_bag_outlined,
              size: 16,
              color: colorScheme.primary,
            ),
      label: Text(label),
      backgroundColor: colorScheme.surfaceContainerHighest,
      side: BorderSide.none,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      onPressed: () {
        if (_deals != null) {
          widget.onOpenDetails(widget.productName, _deals!);
        }
      },
    );
  }
}
