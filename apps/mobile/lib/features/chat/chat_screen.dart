import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/socket_client.dart';
import 'chat_message.dart';

class ChatScreen extends ConsumerStatefulWidget {
  final String roomId;
  final String currentUserId;
  const ChatScreen({super.key, required this.roomId, required this.currentUserId});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final List<ChatMessage> _messages = [];
  final TextEditingController _controller = TextEditingController();
  late final socket = ref.read(socketProvider);

  @override
  void initState() {
    super.initState();
    socket.connect();
    
    socket.onConnect((_) {
      socket.emit('joinRoom', {'roomId': widget.roomId, 'userId': widget.currentUserId});
    });

    socket.on('roomHistory', (data) {
      if (data != null && data is List) {
        if (mounted) {
          setState(() {
            _messages.clear();
            _messages.addAll(data.map((m) => ChatMessage.fromJson(m)).toList());
          });
        }
      }
    });

    socket.on('newMessage', (data) {
      if (data != null) {
        if (mounted) {
          setState(() {
            _messages.insert(0, ChatMessage.fromJson(data));
          });
        }
      }
    });
  }

  @override
  void dispose() {
    socket.disconnect();
    _controller.dispose();
    super.dispose();
  }

  void _sendMessage() {
    if (_controller.text.isNotEmpty) {
      socket.emit('sendMessage', {
        'roomId': widget.roomId,
        'senderId': widget.currentUserId,
        'content': _controller.text,
      });
      _controller.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Lobby Chat')),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              reverse: true, // Display newest messages at the bottom
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isMe = msg.senderId == widget.currentUserId;
                return Align(
                  alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isMe ? Colors.green : Colors.grey[800],
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(msg.content, style: const TextStyle(color: Colors.white, fontSize: 16)),
                  ),
                );
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8.0),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: InputDecoration(
                        hintText: 'Type a message...',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  CircleAvatar(
                    backgroundColor: Colors.green,
                    radius: 24,
                    child: IconButton(
                      icon: const Icon(Icons.send, color: Colors.white),
                      onPressed: _sendMessage,
                    ),
                  )
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
