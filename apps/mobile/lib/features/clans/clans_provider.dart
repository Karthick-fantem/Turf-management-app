import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import 'clan_model.dart';

final allClansProvider = FutureProvider<List<Clan>>((ref) async {
  final dio = ref.watch(dioProvider);
  final response = await dio.get('/clans');
  
  final List<dynamic> data = response.data;
  return data.map((json) => Clan.fromJson(json)).toList();
});
