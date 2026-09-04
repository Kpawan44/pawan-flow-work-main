package com.aistudio.pmwtracker.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

@Serializable
@Entity(tableName = "outsource_orders")
data class OutsourceOrder(
    @PrimaryKey val orderId: String,
    val jobCardNo: String = "",
    val partyName: String = "",
    val itemName: String = "",
    val orderQty: Double = 0.0,
    val unit: String = "KGS",
    val processType: String = "External Heat Treatment",
    val status: String = "Assigned", // Assigned, In Transit, Material Received, Completed
    val supplierName: String = "",
    val poNumber: String = "",
    val expectedDate: String = "",
    val receivedQty: Double = 0.0,
    val remarks: String = "",
    val createdAt: Long = System.currentTimeMillis()
)
