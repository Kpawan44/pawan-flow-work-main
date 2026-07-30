class JobCard {
  final String jobCardNo;
  final String partyName;
  final String itemName;
  final String? itemCode;
  final double orderQty;
  final double netWeight;
  final String unit;
  final String currentDepartment;
  final String status;
  final String createdAt;

  JobCard({
    required this.jobCardNo,
    required this.partyName,
    required this.itemName,
    this.itemCode,
    required this.orderQty,
    required this.netWeight,
    required this.unit,
    required this.currentDepartment,
    required this.status,
    required this.createdAt,
  });

  factory JobCard.fromJson(Map<String, dynamic> json) {
    return JobCard(
      jobCardNo: json['jobCardNo'] ?? '',
      partyName: json['partyName'] ?? '',
      itemName: json['itemName'] ?? '',
      itemCode: json['itemCode'],
      orderQty: (json['orderQty'] as num?)?.toDouble() ?? 0.0,
      netWeight: (json['netWeight'] as num?)?.toDouble() ?? 0.0,
      unit: json['unit'] ?? 'KGS',
      currentDepartment: json['currentDepartment'] ?? 'Raw Material Store',
      status: json['status'] ?? 'In Production',
      createdAt: json['createdAt'] ?? DateTime.now().toIso8601String(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'jobCardNo': jobCardNo,
      'partyName': partyName,
      'itemName': itemName,
      'itemCode': itemCode,
      'orderQty': orderQty,
      'netWeight': netWeight,
      'unit': unit,
      'currentDepartment': currentDepartment,
      'status': status,
      'createdAt': createdAt,
    };
  }
}
