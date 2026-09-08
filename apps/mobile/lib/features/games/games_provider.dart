import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import 'game_model.dart';

final publicGamesProvider = FutureProvider<List<Game>>((ref) async {
  final dio = ref.watch(dioProvider);
  final response = await dio.get('/games/public');
  
  final List<dynamic> data = response.data;
  return data.map((json) => Game.fromJson(json)).toList();
});
