import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'games_provider.dart';

class GamesScreen extends ConsumerWidget {
  const GamesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gamesAsync = ref.watch(publicGamesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Public Lobbies', style: TextStyle(fontWeight: FontWeight.bold)),
        centerTitle: false,
      ),
      body: gamesAsync.when(
        data: (games) {
          if (games.isEmpty) {
            return const Center(child: Text('No public lobbies available right now.'));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(publicGamesProvider),
            child: ListView.builder(
              padding: const EdgeInsets.all(16.0),
              itemCount: games.length,
              itemBuilder: (context, index) {
                final game = games[index];
                final groundName = game.slot?['ground']?['name'] ?? 'Unknown Ground';
                final turfName = game.slot?['ground']?['turf']?['name'] ?? 'Unknown Turf';

                return Card(
                  margin: const EdgeInsets.only(bottom: 16.0),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              '${game.sport} Match',
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                            Chip(
                              label: Text('${game.players.length}/${game.maxPlayers} Joined'),
                              backgroundColor: Colors.green.withOpacity(0.2),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text('$turfName - $groundName', style: const TextStyle(color: Colors.grey)),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('₹${game.pricePerPlayer} / player', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.green)),
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.green,
                                foregroundColor: Colors.white,
                              ),
                              onPressed: () {
                                // TODO: Handle Join Game API Call
                                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Joining game...')));
                              },
                              child: const Text('Join Lobby'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(child: Text('Error: $err')),
      ),
    );
  }
}
