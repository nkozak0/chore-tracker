# Household Chore Tracker

A full-stack, real-time Progressive Web Application (PWA) designed to gamify and manage household chores. Built with Next.js and Supabase, this application features real-time database synchronization, native iOS push notifications, and a modern, motion-driven user interface.

## Features

* **Real-Time Data Synchronization:** Leverages Supabase Realtime to instantly broadcast chore completions, point updates, and activity feeds across all active household clients.
* **Progressive Web App (PWA):** Fully installable on iOS and Android with offline caching and native app-like behavior.
* **Push Notifications:** Custom-built service worker integration using VAPID keys to deliver lock-screen notifications for completed tasks and household alerts.
* **Gamification & Leaderboard:** Dynamic scoring system that tracks household contributions and resets via admin controls.
* **Modern UI/UX:** High-end dark-mode aesthetic utilizing glassmorphism, powered by Framer Motion for spring micro-interactions and Lucide React for crisp iconography.

## Tech Stack

* **Frontend:** Next.js (App Router), React, Tailwind CSS
* **Backend:** Supabase (PostgreSQL, Realtime, REST API)
* **Animation & UI:** Framer Motion, Lucide React
* **Infrastructure:** Vercel (Hosting), Web-Push (Service Workers)

## System Architecture & Engineering Highlights

* **Service Worker Management:** Architected a custom service worker strategy to handle local development caching loops and production-level push notification subscriptions.
* **Database Migrations:** Designed and executed SQL migrations to dynamically update schema requirements (e.g., adding text-based `notes` to chore history) without disrupting existing user data.
* **Environment Configuration:** Managed distinct development and production environments, ensuring secure delivery of VAPID keys for push manager authentication.
* **AI-Assisted Development:** Rapidly prototyped and scaled complex UI components and state logic using advanced LLM prompting, functioning as the primary systems architect.

## Local Setup

To run this project locally, clone the repository and install the dependencies:

```bash
git clone [https://github.com/nkozak0/chore-tracker.git](https://github.com/nkozak0/chore-tracker.git)
cd chore-tracker
npm install
