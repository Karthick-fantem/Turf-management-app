import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'bookings_provider.dart';

class BookingsScreen extends ConsumerWidget {
  const BookingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookingsAsync = ref.watch(myBookingsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Bookings', style: TextStyle(fontWeight: FontWeight.bold)),
        centerTitle: false,
      ),
      body: bookingsAsync.when(
        data: (bookings) {
          if (bookings.isEmpty) {
            return const Center(child: Text('You have no active bookings.'));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(myBookingsProvider),
            child: ListView.builder(
              padding: const EdgeInsets.all(16.0),
              itemCount: bookings.length,
              itemBuilder: (context, index) {
                final booking = bookings[index];
                final groundName = booking.slot['ground']?['name'] ?? 'Unknown Ground';
                final turfName = booking.slot['ground']?['turf']?['name'] ?? 'Unknown Turf';
                final startTime = DateTime.parse(booking.slot['startTime']).toLocal();
                final endTime = DateTime.parse(booking.slot['endTime']).toLocal();

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
                              turfName,
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                            Chip(
                              label: Text(booking.status),
                              backgroundColor: booking.status == 'CONFIRMED' 
                                ? Colors.green.withOpacity(0.2) 
                                : Colors.orange.withOpacity(0.2),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(groundName, style: const TextStyle(color: Colors.grey)),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            const Icon(Icons.calendar_today, size: 16, color: Colors.grey),
                            const SizedBox(width: 8),
                            Text('${startTime.day}/${startTime.month}/${startTime.year}'),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            const Icon(Icons.access_time, size: 16, color: Colors.grey),
                            const SizedBox(width: 8),
                            Text('${startTime.hour}:${startTime.minute.toString().padLeft(2, '0')} - ${endTime.hour}:${endTime.minute.toString().padLeft(2, '0')}'),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Text('Total: ₹${booking.totalAmount}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.green)),
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
