import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

class LocationService {
  Future<Position> getCurrentLocation() async {
    bool serviceEnabled;
    LocationPermission permission;

    serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return Future.error('Location services are disabled.');
    }

    permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return Future.error('Location permissions are denied');
      }
    }

    if (permission == LocationPermission.deniedForever) {
      return Future.error(
        'Location permissions are permanently denied, we cannot request permissions.',
      );
    }

    return await Geolocator.getCurrentPosition();
  }

  Future<void> openNearestHospital() async {
    try {
      final position = await getCurrentLocation();
      final url = Uri.parse(
        "https://www.google.com/maps/search/hospital/@${position.latitude},${position.longitude},14z",
      );
      if (await canLaunchUrl(url)) {
        await launchUrl(url);
      }
    } catch (e) {
      // Fallback if location fails
      final url = Uri.parse("https://www.google.com/maps/search/hospital");
      if (await canLaunchUrl(url)) {
        await launchUrl(url);
      }
    }
  }
}
