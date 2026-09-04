package com.aistudio.pmwtracker.ai.model

import com.aistudio.pmwtracker.model.Department
import com.aistudio.pmwtracker.model.JobPriority

sealed interface ExecutedAction {
    data class MaterialTransferred(
        val movementId: String,
        val jobCardNo: String,
        val itemName: String,
        val fromDept: Department,
        val toDept: Department,
        val quantity: Double,
        val unit: String,
        val remarks: String
    ) : ExecutedAction

    data class JobCardCreated(
        val jobCardNo: String,
        val partyName: String,
        val itemName: String,
        val itemCode: String,
        val orderQty: Double,
        val unit: String,
        val priority: JobPriority,
        val heatTreatment: Boolean,
        val department: Department
    ) : ExecutedAction

    data class OutsourceOrderCreated(
        val orderId: String,
        val partyName: String,
        val itemName: String,
        val supplierName: String,
        val processType: String,
        val orderQty: Double,
        val unit: String
    ) : ExecutedAction

    data class BottleneckAudit(
        val departmentLoads: List<DepartmentLoad>,
        val criticalAlerts: List<String>,
        val recommendations: List<String>
    ) : ExecutedAction

    data class HeatTreatmentAudit(
        val pendingCount: Int,
        val pendingCards: List<String>,
        val safetyNotes: String
    ) : ExecutedAction
}

data class DepartmentLoad(
    val department: Department,
    val count: Int,
    val totalQty: Double,
    val unit: String,
    val isBottleneck: Boolean
)
