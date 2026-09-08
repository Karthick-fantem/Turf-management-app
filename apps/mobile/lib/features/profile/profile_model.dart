class UserProfile {
  final String id;
  final String fullName;
  final String phone;
  final int xp;
  final int level;
  final List<dynamic> badges;

  UserProfile({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.xp,
    required this.level,
    required this.badges,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] ?? '',
      fullName: json['profile']?['fullName'] ?? 'Player',
      phone: json['phone'] ?? '',
      xp: json['profile']?['xp'] ?? 0,
      level: json['profile']?['level'] ?? 1,
      badges: json['badges'] ?? [],
    );
  }
}
