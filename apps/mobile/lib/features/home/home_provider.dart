import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import 'turf_model.dart';

final turfsProvider = FutureProvider<List<Turf>>((ref) async {
  final dio = ref.watch(dioProvider);
  final response = await dio.get('/turfs');
  
  final List<dynamic> data = response.data;
  return data.map((json) => Turf.fromJson(json)).toList();
});
