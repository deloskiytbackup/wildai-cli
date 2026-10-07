# WildAI CLI ⚡

> Oficjalne, nowoczesne i szybkie narzędzie wiersza poleceń (CLI) dla ekosystemu **WildAI**. Umożliwia wygodną pracę z modelami sztucznej inteligencji, streamowanie odpowiedzi w czasie rzeczywistym, dokładne monitorowanie zużycia tokenów oraz automatyzację zadań deweloperskich w trybie Agenta.

---

## 🚀 Główne Funkcje

- ⚡ **Błyskawiczne Streamowanie:** Płynne generowanie odpowiedzi bezpośrednio w terminalu.
- 📊 **Monitorowanie Tokenów na Żywo:**
  - Tokeny wejściowe (prompt) i wyjściowe (odpowiedź).
  - Rzeczywista prędkość generacji w `tok/s`.
  - Czas odpowiedzi serwera (TTFT - Time To First Token).
  - Szacowany koszt zapytania w USD ($).
- 🛠️ **Tryb Agenta Kodującego:** Dostęp do narzędzi systemowych: odczyt i edycja plików, przeglądanie katalogów, status git oraz bezpieczne uruchamianie komend shella.
- 💬 **Tryb Czat:** Interaktywna konwersacja z zachowaniem kontekstu wątku.
- 🎯 **Tryb One-Shot:** Zadaj pytanie bezpośrednio z wiersza poleceń bez wchodzenia do czatu.
- 📋 **Integracja ze Schowkiem:** Szybkie kopiowanie odpowiedzi do schowka macOS (`pbcopy`).
- 📁 **Eksport do Markdown:** Zapis całej rozmowy do pliku `.md`.
- 🌐 **Inteligentne Zarządzanie Modelami:** Interaktywne menu wyboru modeli i automatyczna kontrola planów subskrypcji.

---

## 📦 Instalacja

### Globalnie przez NPM:
```bash
npm install -g wildai-cli
```

### Z repozytorium (Lokalnie):
```bash
git clone https://github.com/deloskiytbackup/wildai-cli.git
cd wildai-cli
npm install
npm run build
npm link
```

Po instalacji polecenie `wildai` będzie dostępne globalnie w Twoim systemie!

---

## 💻 Szybki Start

### 1. Logowanie do konta WildAI
```bash
wildai login
```
Podaj swój e-mail i hasło z serwisu [chat.wildai.pl](https://chat.wildai.pl). Token sesji zostanie bezpiecznie zapisany lokalnie w `~/.wildai-cli/config.json`.

### 2. Rozpoczęcie interaktywnego czatu
```bash
wildai
```
lub:
```bash
wildai chat
```

### 3. Szybkie zapytanie z wiersza poleceń (One-Shot)
```bash
wildai "Napisz funkcję w TypeScript do sortowania tablicy obiektów"
```

### 4. Przegląd dostępnych modeli
```bash
wildai models
```

---

## ⌨️ Polecenia wewnątrz czatu (Slash Commands)

Podczas aktywnej sesji czatu masz do dyspozycji wygodne polecenia:

| Polecenie | Opis |
|---|---|
| `/model` | Wybierz aktywny model AI z listy dostępnych modeli |
| `/mode` | Przełącz tryb wykonania: Czat standardowy ↔ Agent z narzędziami |
| `/tokens` lub `/stats` | Wyświetl pełne podsumowanie sesji tokenów i kosztów |
| `/tools` | Wyświetl listę dostępnych narzędzi deweloperskich |
| `/copy` | Skopiuj ostatnią odpowiedź asystenta do schowka |
| `/save [plik]` | Zapisz całą historię rozmowy do pliku Markdown (.md) |
| `/whoami` | Wyświetl informacje o zalogowanym użytkowniku i planie |
| `/login` | Zaloguj się bez opuszczania sesji |
| `/logout` | Wyloguj się i usuń zapisany token |
| `/clear` | Wyczyść ekran terminala oraz pamięć bieżącego czatu |
| `/exit` | Zakończ działanie CLI |

---

## ⚙️ Konfiguracja

Konfiguracja przechowywana jest w pliku `~/.wildai-cli/config.json`.

Możesz ją modyfikować poleceniami:
```bash
# Zmiana domyślnego modelu:
wildai config -m claude-opus-5.5

# Reset do ustawień fabrycznych:
wildai config --reset
```

---

## 📄 Licencja

Projekt udostępniany na licencji MIT.
Odwiedź stronę główną: [chat.wildai.pl](https://chat.wildai.pl)
