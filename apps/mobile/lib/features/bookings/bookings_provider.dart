import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import 'booking_model.dart';

final myBookingsProvider = FutureProvider<List<Booking>>((ref) async {
  final dio = ref.watch(dioProvider);
  final response = await dio.get('/bookings/my-bookings');
  
  final List<dynamic> data = response.data;
  return data.map((json) => Booking.fromJson(json)).toList();
});
