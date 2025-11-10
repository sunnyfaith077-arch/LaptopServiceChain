;; contracts/complaint-manager.clar

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-CONTRACT-ID u101)
(define-constant ERR-INVALID-DESCRIPTION u102)
(define-constant ERR-INVALID-STATUS u103)
(define-constant ERR-COMPLAINT-ALREADY-EXISTS u104)
(define-constant ERR-COMPLAINT-NOT-FOUND u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-SEVERITY-INVALID u107)
(define-constant ERR-ATTACHMENT-INVALID u108)
(define-constant ERR-ESCALATION-NOT-ALLOWED u109)
(define-constant ERR-RESOLUTION-FEE-INSUFFICIENT u110)
(define-constant ERR-DUPLICATE-ATTACHMENT u111)
(define-constant ERR-MAX-COMPLAINTS-EXCEEDED u112)
(define-constant ERR-INVALID-USER-ROLE u113)
(define-constant ERR-STATUS-TRANSITION-INVALID u114)
(define-constant ERR-GRACE-PERIOD-EXPIRED u115)
(define-constant ERR-INVALID-PRIORITY u116)

(define-data-var next-complaint-id uint u0)
(define-data-var max-complaints-per-contract uint u50)
(define-data-var resolution-fee uint u5000)
(define-data-var authority-contract (optional principal) none)
(define-data-var grace-period-blocks uint u144)

(define-map complaints
  uint
  {
    contract-id: uint,
    description: (string-utf8 256),
    status: (string-utf8 32),
    timestamp: uint,
    severity: (string-utf8 20),
    priority: uint,
    creator: principal,
    attachments: (list 10 (string-utf8 128)),
    escalation-level: uint,
    resolution-notes: (optional (string-utf8 256)),
    resolved-by: (optional principal)
  }
)

(define-map complaints-by-contract
  { contract-id: uint, description-hash: (string-utf8 64) }
  uint
)

(define-map complaint-updates
  uint
  {
    update-status: (string-utf8 32),
    update-timestamp: uint,
    updater: principal,
    reason: (string-utf8 128)
  }
)

(define-map contract-complaint-count
  uint
  uint
)

(define-read-only (get-complaint (id uint))
  (map-get? complaints id)
)

(define-read-only (get-complaint-updates (id uint))
  (map-get? complaint-updates id)
)

(define-read-only (get-complaints-by-contract (contract-id uint))
  (ok (list {}))
)

(define-read-only (is-complaint-registered (contract-id uint) (description (string-utf8 256)))
  (let ((hash (hash160 (concat (to-ascii description) (to-ascii (to-hex contract-id))))))
    (is-some (map-get? complaints-by-contract { contract-id: contract-id, description-hash: (to-str hash) }))
  )
)

(define-private (validate-description (desc (string-utf8 256)))
  (if (and (> (len desc) u5) (<= (len desc) u256))
      (ok true)
      (err ERR-INVALID-DESCRIPTION))
)

(define-private (validate-status (status (string-utf8 32)))
  (if (or (is-eq status "pending")
          (is-eq status "monitoring")
          (is-eq status "escalated")
          (is-eq status "resolved")
          (is-eq status "closed"))
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-private (validate-severity (sev (string-utf8 20)))
  (if (or (is-eq sev "low") (is-eq sev "medium") (is-eq sev "high"))
      (ok true)
      (err ERR-SEVERITY-INVALID))
)

(define-private (validate-priority (pri uint))
  (if (<= pri u5)
      (ok true)
      (err ERR-INVALID-PRIORITY))
)

(define-private (validate-attachment (att (string-utf8 128)))
  (if (and (> (len att) u0) (<= (len att) u128))
      (ok true)
      (err ERR-ATTACHMENT-INVALID))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-user-role (user principal))
  (if (or (is-eq user tx-sender) (is-some (var-get authority-contract)))
      (ok true)
      (err ERR-INVALID-USER-ROLE))
)

(define-private (validate-status-transition (current (string-utf8 32)) (next (string-utf8 32)))
  (if (or (and (is-eq current "pending") (is-eq next "monitoring"))
          (and (is-eq current "monitoring") (is-eq next "escalated"))
          (and (is-eq current "escalated") (is-eq next "resolved"))
          (and (is-eq current "resolved") (is-eq next "closed")))
      (ok true)
      (err ERR-STATUS-TRANSITION-INVALID))
)

(define-private (validate-grace-period (ts uint))
  (if (<= (- block-height ts) (var-get grace-period-blocks))
      (ok true)
      (err ERR-GRACE-PERIOD-EXPIRED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true))
)

(define-public (set-resolution-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set resolution-fee new-fee)
    (ok true))
)

(define-public (set-grace-period (new-period uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set grace-period-blocks new-period)
    (ok true))
)

(define-public (file-complaint
  (contract-id uint)
  (description (string-utf8 256))
  (severity (string-utf8 20))
  (priority uint)
  (attachments (list 10 (string-utf8 128)))
)
  (let (
        (next-id (var-get next-complaint-id))
        (contract-count (default-to u0 (map-get? contract-complaint-count contract-id)))
      )
    (asserts! (< contract-count (var-get max-complaints-per-contract)) (err ERR-MAX-COMPLAINTS-EXCEEDED))
    (try! (validate-description description))
    (try! (validate-severity severity))
    (try! (validate-priority priority))
    (fold validate-attachment (ok true) attachments)
    (try! (validate-user-role tx-sender))
    (asserts! (is-none (map-get? complaints-by-contract { contract-id: contract-id, description-hash: (to-str (hash160 (concat (to-ascii description) (to-ascii (to-hex contract-id))))) })) (err ERR-COMPLAINT-ALREADY-EXISTS))
    (let ((hash (to-str (hash160 (concat (to-ascii description) (to-ascii (to-hex contract-id)))))))
      (map-set complaints-by-contract { contract-id: contract-id, description-hash: hash } next-id)
    )
    (map-set complaints next-id
      {
        contract-id: contract-id,
        description: description,
        status: "pending",
        timestamp: block-height,
        severity: severity,
        priority: priority,
        creator: tx-sender,
        attachments: attachments,
        escalation-level: u0,
        resolution-notes: none,
        resolved-by: none
      }
    )
    (map-set contract-complaint-count contract-id (+ contract-count u1))
    (var-set next-complaint-id (+ next-id u1))
    (print { event: "complaint-filed", id: next-id })
    (ok next-id))
)

(define-public (update-complaint-status
  (complaint-id uint)
  (new-status (string-utf8 32))
  (reason (string-utf8 128))
)
  (let ((complaint (map-get? complaints complaint-id)))
    (match complaint
      some-complaint
        (begin
          (asserts! (is-eq (get creator some-complaint) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-status new-status))
          (try! (validate-status-transition (get status some-complaint) new-status))
          (try! (validate-grace-period (get timestamp some-complaint)))
          (if (is-eq new-status "resolved")
            (begin
              (try! (stx-transfer? (var-get resolution-fee) tx-sender (unwrap! (var-get authority-contract) (err ERR-NOT-AUTHORIZED))))
              (map-set complaints complaint-id
                (merge some-complaint
                  {
                    status: new-status,
                    resolution-notes: (some reason),
                    resolved-by: (some tx-sender)
                  }
                )
              )
            )
            (map-set complaints complaint-id
              (merge some-complaint { status: new-status })
            )
          )
          (map-set complaint-updates complaint-id
            {
              update-status: new-status,
              update-timestamp: block-height,
              updater: tx-sender,
              reason: reason
            }
          )
          (print { event: "complaint-updated", id: complaint-id })
          (ok true)
        )
      (err ERR-COMPLAINT-NOT-FOUND)
    )
  )
)

(define-public (add-attachment (complaint-id uint) (attachment (string-utf8 128)))
  (let ((complaint (map-get? complaints complaint-id)))
    (match complaint
      some-complaint
        (begin
          (asserts! (is-eq (get creator some-complaint) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-attachment attachment))
          (asserts! (not (is-in-list? attachment (get attachments some-complaint))) (err ERR-DUPLICATE-ATTACHMENT))
          (let ((new-attachments (unwrap! (as-max-len? (append (get attachments some-complaint) attachment) u10) (err ERR-ATTACHMENT-INVALID))))
            (map-set complaints complaint-id
              (merge some-complaint { attachments: new-attachments })
            )
            (ok true)
          )
        )
      (err ERR-COMPLAINT-NOT-FOUND)
    )
  )
)

(define-public (escalate-complaint (complaint-id uint))
  (let ((complaint (map-get? complaints complaint-id)))
    (match complaint
      some-complaint
        (begin
          (asserts! (is-eq (get status some-complaint) "monitoring") (err ERR-ESCALATION-NOT-ALLOWED))
          (asserts! (< (get escalation-level some-complaint) u3) (err ERR-ESCALATION-NOT-ALLOWED))
          (map-set complaints complaint-id
            (merge some-complaint
              {
                status: "escalated",
                escalation-level: (+ (get escalation-level some-complaint) u1)
              }
            )
          )
          (print { event: "complaint-escalated", id: complaint-id })
          (ok true)
        )
      (err ERR-COMPLAINT-NOT-FOUND)
    )
  )
)

(define-public (get-complaint-count)
  (ok (var-get next-complaint-id))
)

(define-public (check-complaint-existence (contract-id uint) (description (string-utf8 256)))
  (ok (is-complaint-registered contract-id description))
)