class Clan {
  final String id;
  final String name;
  final String description;
  final String? avatarUrl;
  final int clanXp;
  final int level;
  final List<dynamic> members;

  Clan({
    required this.id,
    required this.name,
    required this.description,
    this.avatarUrl,
    required this.clanXp,
    required this.level,
    required this.members,
  });

  factory Clan.fromJson(Map<String, dynamic> json) {
    return Clan(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      description: json['description'] ?? '',
      avatarUrl: json['avatarUrl'],
      clanXp: json['clanXp'] ?? 0,
      level: json['level'] ?? 1,
      members: json['members'] ?? [],
    );
  }
}
