import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import 'profile_model.dart';

final userProfileProvider = FutureProvider<UserProfile>((ref) async {
  final dio = ref.watch(dioProvider);
  final response = await dio.get('/users/me');
  return UserProfile.fromJson(response.data);
});
