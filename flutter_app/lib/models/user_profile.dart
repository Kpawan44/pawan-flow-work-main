class UserProfile {
  final String userId;
  final String name;
  final String email;
  final String role; // 'super_admin' | 'admin' | 'manager' | 'operator'
  final String department;
  final bool isActive;

  UserProfile({
    required this.userId,
    required this.name,
    required this.email,
    required this.role,
    required this.department,
    required this.isActive,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      userId: json['userId'] ?? '',
      name: json['name'] ?? '',
      email: json['email'] ?? '',
      role: json['role'] ?? 'operator',
      department: json['department'] ?? 'Production',
      isActive: json['isActive'] ?? true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'name': name,
      'email': email,
      'role': role,
      'department': department,
      'isActive': isActive,
    };
  }
}
