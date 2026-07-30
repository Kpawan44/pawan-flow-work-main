class MaterialMovement {
  final String movementId;
  final String jobCardNo;
  final String fromDepartment;
  final String toDepartment;
  final double quantity;
  final String requestedUnit;
  final String transferBy;
  final String transferDate;
  final bool accepted;
  final String? acceptedBy;
  final String? acceptedDate;
  final String? remarks;

  MaterialMovement({
    required this.movementId,
    required this.jobCardNo,
    required this.fromDepartment,
    required this.toDepartment,
    required this.quantity,
    required this.requestedUnit,
    required this.transferBy,
    required this.transferDate,
    required this.accepted,
    this.acceptedBy,
    this.acceptedDate,
    this.remarks,
  });

  factory MaterialMovement.fromJson(Map<String, dynamic> json) {
    return MaterialMovement(
      movementId: json['movementId'] ?? '',
      jobCardNo: json['jobCardNo'] ?? '',
      fromDepartment: json['fromDepartment'] ?? '',
      toDepartment: json['toDepartment'] ?? '',
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0.0,
      requestedUnit: json['requestedUnit'] ?? 'KGS',
      transferBy: json['transferBy'] ?? 'Operator',
      transferDate: json['transferDate'] ?? DateTime.now().toIso8601String(),
      accepted: json['accepted'] ?? false,
      acceptedBy: json['acceptedBy'],
      acceptedDate: json['acceptedDate'],
      remarks: json['remarks'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'movementId': movementId,
      'jobCardNo': jobCardNo,
      'fromDepartment': fromDepartment,
      'toDepartment': toDepartment,
      'quantity': quantity,
      'requestedUnit': requestedUnit,
      'transferBy': transferBy,
      'transferDate': transferDate,
      'accepted': accepted,
      'acceptedBy': acceptedBy,
      'acceptedDate': acceptedDate,
      'remarks': remarks,
    };
  }
}
