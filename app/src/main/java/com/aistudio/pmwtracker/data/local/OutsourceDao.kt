package com.aistudio.pmwtracker.data.local

import androidx.room.*
import com.aistudio.pmwtracker.model.OutsourceOrder
import kotlinx.coroutines.flow.Flow

@Dao
interface OutsourceDao {
    @Query("SELECT * FROM outsource_orders ORDER BY createdAt DESC")
    fun getAllOutsourceOrders(): Flow<List<OutsourceOrder>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutsourceOrder(order: OutsourceOrder)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutsourceOrders(orders: List<OutsourceOrder>)

    @Update
    suspend fun updateOutsourceOrder(order: OutsourceOrder)
}
