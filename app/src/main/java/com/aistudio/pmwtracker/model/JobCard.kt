package com.aistudio.pmwtracker.model

import androidx.compose.ui.graphics.Color
import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

enum class JobCardStatus(val label: String) {
    PENDING("Pending"),
    IN_PROCESS("In Process"),
    COMPLETED("Completed"),
    HOLD("On Hold"),
    CANCELLED("Cancelled"),
    REJECTED("Rejected");

    fun getColor(): Color = when (this) {
        PENDING -> Color(0xFFF97316) // Orange
        IN_PROCESS -> Color(0xFF3B82F6) // Blue
        COMPLETED -> Color(0xFF10B981) // Green
        HOLD -> Color(0xFFEAB308) // Yellow
        CANCELLED -> Color(0xFF64748B) // Slate
        REJECTED -> Color(0xFFEF4444) // Red
    }
}

enum class JobPriority(val label: String) {
    LOW("Low"),
    MEDIUM("Medium"),
    HIGH("High"),
    URGENT("Urgent");

    fun getColor(): Color = when (this) {
        LOW -> Color(0xFF64748B)
        MEDIUM -> Color(0xFF3B82F6)
        HIGH -> Color(0xFFF97316)
        URGENT -> Color(0xFFDC2626)
    }
}

@Serializable
@Entity(tableName = "job_cards")
data class JobCard(
    @PrimaryKey val jobCardNo: String,
    val orderNo: String = "",
    val poNumber: String = "",
    val partyName: String = "",
    val itemName: String = "",
    val itemCode: String = "",
    val orderQty: Double = 0.0,
    val currentQty: Double = 0.0,
    val unit: String = "KGS",
    val balanceQty: Double = 0.0,
    val currentDepartment: Department = Department.PRODUCTION,
    val status: JobCardStatus = JobCardStatus.PENDING,
    val priority: JobPriority = JobPriority.MEDIUM,
    val heatTreatmentRequired: Boolean = false,
    val operatorName: String = "",
    val wireScrapQty: Double = 0.0,
    val targetDate: String = "",
    val deliveryDate: String = "",
    val notes: String = "",
    val rackNo: String = "",
    val binLocation: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
