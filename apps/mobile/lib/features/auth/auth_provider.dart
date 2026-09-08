import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';

class AuthState {
  final bool isLoading;
  final bool otpSent;
  final String? error;
  final String? phone;

  AuthState({this.isLoading = false, this.otpSent = false, this.error, this.phone});

  AuthState copyWith({bool? isLoading, bool? otpSent, String? error, String? phone}) {
    return AuthState(
      isLoading: isLoading ?? this.isLoading,
      otpSent: otpSent ?? this.otpSent,
      error: error, // null out error by default unless specified
      phone: phone ?? this.phone,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref ref;

  AuthNotifier(this.ref) : super(AuthState());

  Future<void> sendOtp(String phone) async {
    state = state.copyWith(isLoading: true, error: null, phone: phone);
    try {
      final dio = ref.read(dioProvider);
      await dio.post('/auth/send-otp', data: {'phone': phone});
      state = state.copyWith(isLoading: false, otpSent: true);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<bool> verifyOtp(String otp) async {
    if (state.phone == null) return false;
    state = state.copyWith(isLoading: true, error: null);
    try {
      final dio = ref.read(dioProvider);
      final response = await dio.post('/auth/verify-otp', data: {
        'phone': state.phone,
        'otp': otp,
      });
      
      final token = response.data['access_token'];
      if (token != null) {
        final storage = ref.read(secureStorageProvider);
        await storage.write(key: 'jwt_token', value: token);
        state = state.copyWith(isLoading: false);
        return true; // Success
      }
      throw Exception('Token not found in response');
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
