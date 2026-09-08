package com.aistudio.pmwtracker.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

@Serializable
@Entity(tableName = "material_movements")
data class MaterialMovement(
    @PrimaryKey val movementId: String,
    val jobCardNo: String,
    val itemName: String = "",
    val fromDepartment: Department,
    val toDepartment: Department,
    val quantity: Double,
    val unit: String = "KGS",
    val transferBy: String = "Operator",
    val transferDate: Long = System.currentTimeMillis(),
    val accepted: Boolean = false,
    val acceptedBy: String = "",
    val acceptedDate: Long? = null,
    val remarks: String = "",
    val rejectionReason: String? = null,
    val rackNo: String = "",
    val binLocation: String = ""
)
