import 'package:flutter/material.dart';

class AccessibleButton extends StatelessWidget {
  final String label;
  final VoidCallback onPressed;
  final Color? color;
  final IconData? icon;
  final bool isEmergency;

  const AccessibleButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.color,
    this.icon,
    this.isEmergency = false,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Semantics(
      button: true,
      label: label,
      hint: isEmergency
          ? "Double tap to call help immediately"
          : "Double tap to activate",
      child: SizedBox(
        width: double.infinity,
        height: 64, // Taller touch target
        child: FilledButton(
          onPressed: onPressed,
          style: FilledButton.styleFrom(
            backgroundColor: isEmergency
                ? colorScheme.error
                : (color ?? colorScheme.primary),
            foregroundColor: isEmergency
                ? colorScheme.onError
                : (color != null ? Colors.white : colorScheme.onPrimary),
            elevation: 2,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 28),
                const SizedBox(width: 12),
              ],
              Text(
                label,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
