# 📈 Paper Trading & Virtual Portfolio Engine

## 📖 Problem Statement

While financial markets are more accessible than ever, the learning curve remains steep and the financial risk for newcomers is high. Existing educational materials often lack hands-on applicability, and real trading platforms offer limited sandbox environments for testing strategies without deploying actual capital.

**The Solution:** A risk-free, highly accurate simulated trading platform that mirrors real-world market mechanics. By utilizing live market data streams and virtual cash, this application provides a safe sandbox environment that acts as both an educational tool for novice investors and a production-leveraged acquisition funnel for broader financial services.

To ensure realism, the core engine must strictly enforce state modeling, handle concurrent order executions without race conditions, and maintain an immutable, audit-ready financial ledger.

---

## ✨ Key Features

* **Virtual Wallet & Simulated Order Placement:** Users are provisioned with a virtual cash balance capable of executing Market and Limit orders based on real-world constraints (e.g., sufficient funds and asset availability).
* **Live-Price Portfolio Valuation:** Dynamic calculation of total portfolio value relying on high-frequency market data ingestion to reflect real-time equity states.
* **Immutable Transaction Ledger:** An append-only database architecture guaranteeing the strict data integrity and auditability required of financial applications.
* **Leaderboard & Ranking:** Gamification elements that rank user performance based on ROI and overall portfolio valuation to encourage competitive learning.
* **Reset & Restart Capability:** A secure "panic button" workflow that liquidates active positions, cancels pending orders, and restores the virtual wallet to its initial state for continuous practice.

---

## 🛠️ Tech Stack

This project is engineered for high I/O throughput and strict data governance, prioritizing execution speed and mathematical precision.

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js (Plain JS) | High-concurrency event loop for rapid asynchronous API requests and WebSocket integrations. |
| **Web Framework** | Express.js | RESTful routing and middleware management. |
| **Database** | PostgreSQL | Relational schema enforcement, ACID-compliant transactions, and explicit row-level locking (`FOR UPDATE`). |
| **Database Client** | `pg` (node-postgres) | Direct, low-level database connection pooling. |
| **Financial Math** | `decimal.js` | Prevention of native JavaScript floating-point rounding errors during transactional calculations. |

---

## 🏗️ System Architecture Highlights

1.  **State Modeling & Concurrency:** Utilizing explicit SQL transaction blocks (`BEGIN`, `COMMIT`, `ROLLBACK`) and row-level locks to prevent over-drafting and race conditions when users rapidly submit orders.
2.  **Append-Only Ledger:** The `transactions` table never accepts `UPDATE` or `DELETE` commands. Every execution is a net-new record, ensuring a pristine paper trail of all virtual cash movements.
3.  **Modular Clean Architecture:** Separation of concerns across API routing (`controllers`), business logic (`services`), and database interactions (`repositories`) to maintain a scalable and testable codebase.