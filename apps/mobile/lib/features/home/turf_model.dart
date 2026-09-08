class Turf {
  final String id;
  final String name;
  final String address;
  final String? description;
  final List<Ground> grounds;

  Turf({
    required this.id,
    required this.name,
    required this.address,
    this.description,
    required this.grounds,
  });

  factory Turf.fromJson(Map<String, dynamic> json) {
    return Turf(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      address: json['address'] ?? '',
      description: json['description'],
      grounds: (json['grounds'] as List?)?.map((g) => Ground.fromJson(g)).toList() ?? [],
    );
  }
}

class Ground {
  final String id;
  final String name;
  final String sport;
  final int price;

  Ground({
    required this.id,
    required this.name,
    required this.sport,
    required this.price,
  });

  factory Ground.fromJson(Map<String, dynamic> json) {
    return Ground(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      sport: json['sport'] ?? '',
      price: json['price'] ?? 0,
    );
  }
}
