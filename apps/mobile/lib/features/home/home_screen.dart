import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'home_provider.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final turfsAsyncValue = ref.watch(turfsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Turff Discovery', style: TextStyle(fontWeight: FontWeight.bold)),
        centerTitle: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.person),
            onPressed: () {
              context.push('/profile');
            },
          )
        ],
      ),
      body: turfsAsyncValue.when(
        data: (turfs) {
          if (turfs.isEmpty) {
            return const Center(child: Text('No turfs found near you.'));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(turfsProvider),
            child: ListView.builder(
              padding: const EdgeInsets.all(16.0),
              itemCount: turfs.length,
              itemBuilder: (context, index) {
                final turf = turfs[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 16.0),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Placeholder for Turf Image
                      Container(
                        height: 150,
                        width: double.infinity,
                        decoration: const BoxDecoration(
                          color: Colors.grey,
                          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
                        ),
                        child: const Icon(Icons.image, size: 50, color: Colors.white54),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              turf.name,
                              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                const Icon(Icons.location_on, size: 16, color: Colors.grey),
                                const SizedBox(width: 4),
                                Expanded(child: Text(turf.address, style: const TextStyle(color: Colors.grey))),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8.0,
                              children: turf.grounds.map((g) => Chip(
                                label: Text(g.sport, style: const TextStyle(fontSize: 12)),
                                backgroundColor: Colors.green.withOpacity(0.2),
                                padding: EdgeInsets.zero,
                              )).toList(),
                            )
                          ],
                        ),
                      )
                    ],
                  ),
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Error loading turfs: $err', style: const TextStyle(color: Colors.red)),
              ElevatedButton(
                onPressed: () => ref.refresh(turfsProvider),
                child: const Text('Retry'),
              )
            ],
          ),
        ),
      ),
    );
  }
}
