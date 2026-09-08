import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:flutter_riverpod/flutter_riverpod.dart';

final socketProvider = Provider<IO.Socket>((ref) {
  // Uses 10.0.2.2 for Android emulator to hit local NestJS backend
  IO.Socket socket = IO.io('http://10.0.2.2:3000', <String, dynamic>{
    'transports': ['websocket'],
    'autoConnect': false,
  });

  return socket;
});
