class Booking {
  final String id;
  final String status;
  final int totalAmount;
  final Map<String, dynamic> slot;

  Booking({
    required this.id,
    required this.status,
    required this.totalAmount,
    required this.slot,
  });

  factory Booking.fromJson(Map<String, dynamic> json) {
    return Booking(
      id: json['id'] ?? '',
      status: json['status'] ?? 'PENDING',
      totalAmount: json['totalAmount'] ?? 0,
      slot: json['slot'] ?? {},
    );
  }
}
