class Game {
  final String id;
  final String sport;
  final int minPlayers;
  final int maxPlayers;
  final int pricePerPlayer;
  final List<dynamic> players;
  final Map<String, dynamic>? slot; 

  Game({
    required this.id,
    required this.sport,
    required this.minPlayers,
    required this.maxPlayers,
    required this.pricePerPlayer,
    required this.players,
    this.slot,
  });

  factory Game.fromJson(Map<String, dynamic> json) {
    return Game(
      id: json['id'] ?? '',
      sport: json['sport'] ?? '',
      minPlayers: json['minPlayers'] ?? 0,
      maxPlayers: json['maxPlayers'] ?? 0,
      pricePerPlayer: json['pricePerPlayer'] ?? 0,
      players: json['players'] ?? [],
      slot: json['slot'],
    );
  }
}
