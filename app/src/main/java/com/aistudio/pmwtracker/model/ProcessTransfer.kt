package com.aistudio.pmwtracker.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

@Serializable
@Entity(tableName = "process_transfers")
data class ProcessTransfer(
    @PrimaryKey val transferId: String,
    val transferNo: String,
    val jobCardNo: String,
    val customer: String = "",
    val itemName: String = "",
    val processType: String = "Repacking", // "Repacking" | "Replating"
    val quantity: Double = 0.0,
    val unit: String = "KGS",
    val fromLocation: String = "Store",
    val status: String = "Sent to Process",
    val transferDate: Long = System.currentTimeMillis(),
    val completedQty: Double = 0.0,
    val remarks: String = ""
)
