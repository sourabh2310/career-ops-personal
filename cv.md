# Sourabh Kumar Patel
**Java Backend Developer | Spring Boot | Microservices | Kafka | PostgreSQL**

+918085231098 · sourabhark.2308@gmail.com · LinkedIn · GitHub

Immediate joiner · Open to remote / hybrid / relocation

## Professional Summary

Java Backend Developer with 4 years of professional software development experience across enterprise and freelance projects, working with Java, Spring Boot, Hibernate/JPA, SQL, and REST APIs. Experienced in building backend applications, developing business-driven solutions, and implementing backend business logic and application workflows. Hands-on experience with Microservices, Kafka, PostgreSQL, MongoDB, Redis, JWT, WebSocket, Docker, and automated testing. Seeking a Java Backend Developer / Software Engineer role and available to join immediately.

## Technical Skills

- **Languages:** Java, SQL
- **Backend & APIs:** Spring Boot, Spring MVC, Spring Data JPA, Hibernate, Spring Cloud, REST APIs, Microservices, WebSocket, Bean Validation, OpenAPI/Swagger
- **Core Java:** OOP, Collections, Streams & Lambdas, Multithreading & Concurrency, Exception Handling
- **Messaging & Security:** Apache Kafka, Event-Driven Architecture, Spring Security, JWT, RBAC
- **Databases & Caching:** PostgreSQL, Oracle, MySQL, Azure Cosmos DB, Redis
- **Testing:** JUnit 5, Mockito, Spring Boot Test, Integration Testing
- **DevOps & Tools:** Git, GitHub, Maven, Docker, Docker Compose, Jenkins
- **Practices:** API Design, Transaction Management, Performance Optimization, Logging & Monitoring, Root Cause Analysis, Database Troubleshooting, Agile/Scrum

## Professional Experience

### Freelance Java Backend Developer
**Vertical Solutions | Subscription usage and overage management platform for AI products**  
December 2025 – September 2026

- Built the complete backend of a subscription usage and overage management platform using Java, Spring Boot, Microservices, and REST APIs, covering AI token usage tracking, monthly subscription limits, and overage management.
- Developed a Kafka-based ingestion pipeline to consume daily raw AI usage events from customer environments and persist in Azure Cosmos DB for durable storage and downstream batch processing.
- Implemented batch background processing to fetch unprocessed usage records from Cosmos DB, aggregate input and output token usage, and store processed data in PostgreSQL for reporting and overage calculation.
- Improved data access across Cosmos DB and PostgreSQL through targeted indexing and query optimization, speeding up processed-usage retrieval and dashboard reporting.
- Added Redis caching for customer, subscription, and license data from the Subscription Manager API, cutting downstream API calls from about 30 per instance per month to 1–2 (refreshed only on changes such as upsells).
- Delivered REST APIs and workflows for daily, weekly, and monthly usage reports, subscription and overage visibility, upsell and dispute requests, and automated progression from a 5-day preliminary notification to invoice processing after 3 more days.

### Career Break & Upskilling
October 2023 – November 2025

- Focused on Java backend development and strengthened skills in Spring Boot, microservices, Kafka, databases, caching, security, and observability through hands-on projects and technical learning.

### Software Engineer
**Cognizant Technology Solutions | Network monitoring, observability, and inventory applications**  
October 2020 – October 2023

- Supported 5+ enterprise network monitoring, observability, and inventory applications, contributing to Java/Spring Boot troubleshooting, bug fixes, enhancements, and SQL/Oracle data analysis.
- Resolved production incidents across Spring Boot services and database components through root cause analysis and corrective fixes, restoring service and preventing repeat issues.
- Used Hibernate/JPA, SQL, and Oracle to analyze application queries, validate records, and fix application-to-database problems affecting production workflows.
- Automated recurring application checks, monitoring activities, reports, and database validations, saving about 1 hour of manual effort per day.
- Supported production and weekend deployments with post-release validation and monitoring, working in an Agile/Scrum team with developers to ensure stable releases.
- Collaborated in an Agile/Scrum environment with developers and cross-functional teams on incident resolution, change implementation, application enhancements, and production support activities.

## Backend Engineering Projects

### SourHub – Microservices E-Commerce Platform
**Java | Spring Cloud | Kafka | PostgreSQL | Redis | Elasticsearch | Docker**

- Built a 9-application microservices backend with API Gateway, authentication, user, product, order, payment, and review domains, using Eureka service discovery and centralized configuration.
- Secured the API Gateway with JWT validation, role- and ownership-based authorization, correlation IDs, and Redis-backed distributed rate limiting (100 requests/minute per client IP).
- Designed reliable Kafka order and payment workflows using a transactional outbox with scheduled retries, retry topics with dead-letter handling, and idempotent consumers to prevent duplicate operations.
- Applied database-per-service across 6 PostgreSQL databases, with Redis caching and Elasticsearch product search to separate transactional, high-frequency, and search workloads.
- Implemented core workflows: multi-seller orders, inventory with payment-failure compensation, payment splits, coupons, returns, shipment tracking, invoices, verified reviews, and seller operations via REST/Feign.
- Implemented JWT-based authentication with short-lived access tokens, refresh-token rotation, and role-based access control for secure user sessions.
- Implemented resilience patterns for downstream services using retries, timeouts, and circuit breakers to handle transient failures and prevent cascading service failures.

### Smart Queue & Appointment Management Platform
**Java | Spring Boot | PostgreSQL | Redis | WebSocket**

- Building a role-based queue and appointment platform supporting scheduled appointments, walk-in queues, multiple service counters, and staff operations.
- Designing workflows with working-hour and holiday validation, conflict prevention, controlled state transitions, priority handling, and approximate wait-time estimation.
- Implementing concurrency-safe booking and queue operations using transactions, constraints, and locking strategies to prevent double booking and duplicate processing.
- Added real-time updates via WebSocket/STOMP, selective Redis caching, and Spring Security with JWT and role-based authorization.

## Education

**B.E. – Electrical & Electronics Engineering**  
Lakshmi Narain College of Technology (LNCT), Bhopal · CGPA: 8.39 / 10
