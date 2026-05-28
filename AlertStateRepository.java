package com.energylog.backend.repository;

import org.springframework.data.jpa.repository.JpaRepository;

import com.energylog.backend.model.AlertState;

public interface AlertStateRepository extends JpaRepository<AlertState, String> {
}
