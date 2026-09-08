package com.aistudio.pmwtracker.data.local

import androidx.room.*
import com.aistudio.pmwtracker.model.MaterialMovement
import kotlinx.coroutines.flow.Flow

@Dao
interface MaterialMovementDao {
    @Query("SELECT * FROM material_movements ORDER BY transferDate DESC")
    fun getAllMovements(): Flow<List<MaterialMovement>>

    @Query("SELECT * FROM material_movements WHERE jobCardNo = :jobCardNo ORDER BY transferDate DESC")
    fun getMovementsForJobCard(jobCardNo: String): Flow<List<MaterialMovement>>

    @Query("SELECT * FROM material_movements WHERE accepted = 0 ORDER BY transferDate DESC")
    fun getPendingMovements(): Flow<List<MaterialMovement>>

    @Query("SELECT * FROM material_movements ORDER BY transferDate DESC")
    suspend fun getAllMovementsList(): List<MaterialMovement>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMovement(movement: MaterialMovement)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMovements(movements: List<MaterialMovement>)

    @Update
    suspend fun updateMovement(movement: MaterialMovement)
}
