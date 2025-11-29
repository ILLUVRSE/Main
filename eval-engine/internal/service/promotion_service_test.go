package service_test

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/ILLUVRSE/Main/eval-engine/internal/model"
	"github.com/ILLUVRSE/Main/eval-engine/internal/service"
	"github.com/stretchr/testify/assert"
)

func TestPromoteFlow(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a stub database connection", err)
	}
	defer db.Close()

	reasoningServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/nodes", r.URL.Path)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok": true}`))
	}))
	defer reasoningServer.Close()

	financeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/finance/ledger/allocate", r.URL.Path)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok": true, "allocationId": "alloc-123"}`))
	}))
	defer financeServer.Close()

	svc := service.NewPromotionService(db, financeServer.URL, reasoningServer.URL)

	req := service.PromotionRequest{
		RequestID:      "req-1",
		ArtifactID:     "artifact-1",
		Reason:         "good score",
		Score:          0.95,
		AuditContext:   map[string]interface{}{"user": "test"},
		IdempotencyKey: "idem-key-1",
	}

	// Idempotency check (not found)
	mock.ExpectQuery("SELECT id, status FROM promotions WHERE idempotency_key").
		WithArgs("idem-key-1").
		WillReturnError(sql.ErrNoRows)

	// Insert
	mock.ExpectExec("INSERT INTO promotions").WillReturnResult(sqlmock.NewResult(1, 1))

	// Update event ID
	mock.ExpectExec("UPDATE promotions SET event_id").WillReturnResult(sqlmock.NewResult(1, 1))

	// Audit Allocation
	mock.ExpectExec("INSERT INTO audit_events").WillReturnResult(sqlmock.NewResult(1, 1))

	// Update status
	mock.ExpectExec("UPDATE promotions SET status").WillReturnResult(sqlmock.NewResult(1, 1))

	// Audit Promotion
	mock.ExpectExec("INSERT INTO audit_events").WillReturnResult(sqlmock.NewResult(1, 1))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	promo, err := svc.Promote(ctx, req)

	assert.NoError(t, err)
	assert.NotNil(t, promo)
	assert.Equal(t, model.PromotionStatusAccepted, promo.Status)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("there were unfulfilled expectations: %s", err)
	}
}

func TestPromoteFlow_Idempotent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a stub database connection", err)
	}
	defer db.Close()

	svc := service.NewPromotionService(db, "", "")

	req := service.PromotionRequest{
		RequestID:      "req-1",
		IdempotencyKey: "idem-key-1",
	}

	// Idempotency check (found)
	mock.ExpectQuery("SELECT id, status FROM promotions WHERE idempotency_key").
		WithArgs("idem-key-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status"}).AddRow("existing-id", "accepted"))

	// Expect NO other calls

	ctx := context.Background()
	promo, err := svc.Promote(ctx, req)

	assert.NoError(t, err)
	assert.Equal(t, "existing-id", promo.ID)
	assert.Equal(t, model.PromotionStatusAccepted, promo.Status)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("there were unfulfilled expectations: %s", err)
	}
}

func TestPromoteFlow_AllocationFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a stub database connection", err)
	}
	defer db.Close()

	reasoningServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok": true}`))
	}))
	defer reasoningServer.Close()

	financeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError) // Simulate failure
	}))
	defer financeServer.Close()

	svc := service.NewPromotionService(db, financeServer.URL, reasoningServer.URL)

	req := service.PromotionRequest{
		RequestID:      "req-fail",
		ArtifactID:     "artifact-fail",
		IdempotencyKey: "idem-fail",
	}

	mock.ExpectQuery("SELECT id, status FROM promotions").WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("INSERT INTO promotions").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE promotions SET event_id").WillReturnResult(sqlmock.NewResult(1, 1))

	// Expect failure handling
	mock.ExpectExec("UPDATE promotions SET status").
		WithArgs("failed", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Expect Audit Failure
	mock.ExpectExec("INSERT INTO audit_events").
		WithArgs(sqlmock.AnyArg(), "promotion.failed", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	ctx := context.Background()
	_, err = svc.Promote(ctx, req)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "allocation failed")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("there were unfulfilled expectations: %s", err)
	}
}
