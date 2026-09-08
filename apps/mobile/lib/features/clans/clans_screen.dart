import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'clans_provider.dart';

class ClansScreen extends ConsumerWidget {
  const ClansScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final clansAsync = ref.watch(allClansProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sports Clans', style: TextStyle(fontWeight: FontWeight.bold)),
        centerTitle: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              // Create Clan logic
            },
          )
        ],
      ),
      body: clansAsync.when(
        data: (clans) {
          if (clans.isEmpty) {
            return const Center(child: Text('No clans found. Be the first to create one!'));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(allClansProvider),
            child: ListView.builder(
              padding: const EdgeInsets.all(16.0),
              itemCount: clans.length,
              itemBuilder: (context, index) {
                final clan = clans[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 16.0),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: ListTile(
                    contentPadding: const EdgeInsets.all(16.0),
                    leading: CircleAvatar(
                      radius: 30,
                      backgroundColor: Colors.green.withOpacity(0.2),
                      child: Text(
                        clan.name.substring(0, 1).toUpperCase(),
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.green),
                      ),
                    ),
                    title: Text(clan.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 4),
                        Text(clan.description, maxLines: 2, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Chip(
                              label: Text('Level ${clan.level}', style: const TextStyle(fontSize: 12)),
                              backgroundColor: Colors.amber.withOpacity(0.2),
                              padding: EdgeInsets.zero,
                            ),
                            const SizedBox(width: 8),
                            Chip(
                              label: Text('${clan.members.length} Members', style: const TextStyle(fontSize: 12)),
                              backgroundColor: Colors.blue.withOpacity(0.2),
                              padding: EdgeInsets.zero,
                            ),
                          ],
                        )
                      ],
                    ),
                    trailing: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                      ),
                      onPressed: () {
                        // Join Clan logic
                      },
                      child: const Text('Join'),
                    ),
                  ),
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(child: Text('Error loading clans: $err')),
      ),
    );
  }
}
