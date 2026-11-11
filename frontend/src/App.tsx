
import { useState, type FormEvent } from "react";
import "./App.css";

import type { PasswordAnalysis } from "./security/passwordEngine";

interface Analysis extends PasswordAnalysis {
  checks: Record<string, boolean>;
}

function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) {
    throw new RangeError("Invalid random integer range");
  }

  const range = 0x100000000;
  const limit = Math.floor(range / max) * max;
  const array = new Uint32Array(1);

  do {
    crypto.getRandomValues(array);
  } while (array[0] >= limit);

  return array[0] % max;
}

function createSecurePassword(length = 20): string {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%^&*_-+=",
  ];

  if (!Number.isInteger(length) || length < groups.length || length > 256) {
    throw new RangeError("Invalid password length");
  }

  const allCharacters = groups.join("");

  const password = groups.map(
    (group) => group[secureRandomInt(group.length)]
  );

  while (password.length < length) {
    password.push(
      allCharacters[secureRandomInt(allCharacters.length)]
    );
  }

  for (let i = password.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join("");
}

function App() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState("overview");

  async function analyzePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!password || loading) return;

    setLoading(true);
    setError("");
    setAnalysis(null);

    try {
      const { analyzePasswordLocally } = await import(
        "./security/passwordEngine"
      );

      const result = await analyzePasswordLocally(password);

      const checks: Record<string, boolean> = {
        "At least 12 characters": password.length >= 12,
        "Uppercase letters": /[A-Z]/.test(password),
        "Lowercase letters": /[a-z]/.test(password),
        Numbers: /[0-9]/.test(password),
        "Special characters": /[^A-Za-z0-9]/.test(password),
      };

      setAnalysis({ ...result, checks });
    } catch {
      setError("Local password analysis failed. Please try again.");
    } finally {
      setPassword("");
      setShowPassword(false);
      setLoading(false);
    }
  }

  function generatePassword() {
    try {
      setPassword(createSecurePassword(20));
      setShowPassword(true);
      setAnalysis(null);
      setError("");
    } catch {
      setError("Secure password generation failed. Please try again.");
    }
  }

  function navigateTo(id: string) {
    setActiveSection(id);

    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  const colors = [
    "#ef6262",
    "#f59e0b",
    "#eabf48",
    "#a3bd65",
    "#8bc58b",
  ];

  const completedChecks = analysis
    ? Object.values(analysis.checks).filter(Boolean).length
    : 0;

  return (
    <main className="sentinel-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">S</div>
          <div>
            <div className="brand-name">SENTINEL</div>
            <div className="brand-subtitle">SECURITY OPERATIONS</div>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>

        <nav className="side-navigation" aria-label="Main navigation">
          <button
            className={`nav-item ${activeSection === "overview" ? "active" : ""}`}
            type="button"
            aria-current={activeSection === "overview" ? "page" : undefined}
            onClick={() => navigateTo("overview")}
          >
            <span className="nav-icon" aria-hidden="true">01</span>
            Overview
          </button>

          <button
            className={`nav-item ${activeSection === "password-lab" ? "active" : ""}`}
            type="button"
            aria-current={activeSection === "password-lab" ? "page" : undefined}
            onClick={() => navigateTo("password-lab")}
          >
            <span className="nav-icon" aria-hidden="true">02</span>
            Password Lab
          </button>

          <button
            className={`nav-item ${activeSection === "security-results" ? "active" : ""}`}
            type="button"
            aria-current={activeSection === "security-results" ? "page" : undefined}
            onClick={() => navigateTo("security-results")}
          >
            <span className="nav-icon" aria-hidden="true">03</span>
            Security Report
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-section-label">SYSTEM</div>

          <div className="system-card">
            <span className="status-dot" />
            <div>
              <strong>LOCAL ENGINE</strong>
              <span>Browser-side analysis</span>
            </div>
          </div>

          <div className="sidebar-version">SENTINEL / VERSION 2.0</div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div>
            <div className="breadcrumb">WORKSPACE / SECURITY LAB</div>
            <div className="topbar-title">Command Center</div>
          </div>

          <div className="topbar-status">
            <span className="status-dot" />
            LOCAL MODE
          </div>
        </header>

        <div className="content-area" id="overview">
          <section className="welcome-section">
            <div>
              <div className="eyebrow">SECURITY OPERATIONS / 001</div>
              <h1>Security Command Center</h1>
              <p>
                Analyze password resilience. Understand exposure.
                Strengthen your digital security.
              </p>
            </div>

            <div className="classification">
              <span>ENVIRONMENT</span>
              <strong>LOCAL / PRIVATE</strong>
            </div>
          </section>

          <section className="overview-grid" aria-label="System overview">
            <article className="overview-card">
              <div className="overview-label">ANALYSIS ENGINE</div>
              <div className="overview-value">ZXCVBN</div>
              <div className="overview-description">
                Password estimation engine
              </div>
              <span className="card-indicator">READY ON DEMAND</span>
            </article>

            <article className="overview-card">
              <div className="overview-label">DATA PROCESSING</div>
              <div className="overview-value">LOCAL</div>
              <div className="overview-description">
                Analysis runs in your browser
              </div>
              <span className="card-indicator">NO PASSWORD UPLOAD</span>
            </article>

            <article className="overview-card">
              <div className="overview-label">INPUT LIMIT</div>
              <div className="overview-value">256</div>
              <div className="overview-description">
                Maximum password characters
              </div>
              <span className="card-indicator">INPUT VALIDATION</span>
            </article>

            <article className="overview-card">
              <div className="overview-label">SECURE GENERATOR</div>
              <div className="overview-value">
                20<span> CHARS</span>
              </div>
              <div className="overview-description">
                Cryptographically secure randomness
              </div>
              <span className="card-indicator">WEB CRYPTO API</span>
            </article>
          </section>

          <section className="workspace-grid">
            <article className="panel analysis-panel" id="password-lab">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">MODULE / 01</div>
                  <h2>Password Analysis</h2>
                  <p>Evaluate password strength locally.</p>
                </div>
                <div className="module-number">01</div>
              </div>

              <form onSubmit={analyzePassword}>
                <label htmlFor="password">PASSWORD INPUT</label>

                <div className="password-input">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setAnalysis(null);
                      setError("");
                    }}
                    placeholder="Enter a test password..."
                    maxLength={256}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Password"
                  />

                  <button
                    type="button"
                    className="show-button"
                    onClick={() => setShowPassword((previous) => !previous)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "HIDE" : "SHOW"}
                  </button>
                </div>

                <div className="input-hint">
                  <span>MAXIMUM LENGTH: 256</span>
                  <span>{password.length} / 256</span>
                </div>

                <button
                  type="button"
                  className="generate-button"
                  onClick={generatePassword}
                  disabled={loading}
                >
                  <span className="button-symbol" aria-hidden="true">+</span>
                  Generate Secure Password
                </button>

                <button
                  type="submit"
                  className="analyze-button"
                  aria-label="Analyze Password"
                  disabled={!password || loading}
                >
                  {loading ? "ANALYZING..." : "EXECUTE SECURITY ANALYSIS"}
                  <span aria-hidden="true">→</span>
                </button>
              </form>

              {loading && (
                <div className="loading-message" role="status">
                  <span className="loading-dot" />
                  Initializing local analysis engine...
                </div>
              )}

              {error && (
                <div className="error-message" role="alert">
                  {error}
                </div>
              )}

              <div className="privacy-note">
                <span className="privacy-symbol" aria-hidden="true">P</span>
                <div>
                  <strong>PRIVACY PROTECTED</strong>
                  <p>
                    Your password is processed locally and cleared
                    from the input after each analysis attempt.
                  </p>
                </div>
              </div>
            </article>

            <article className="panel status-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">SYSTEM / STATUS</div>
                  <h2>Operational Status</h2>
                  <p>Current application configuration.</p>
                </div>
              </div>

              <div className="operational-status">
                <span className="large-status-dot" />
                <div>
                  <strong>LOCAL MODE</strong>
                  <span>Ready for user-initiated analysis</span>
                </div>
              </div>

              <div className="status-divider" />

              <div className="status-row">
                <span>Analysis mode</span>
                <strong>LOCAL</strong>
              </div>
              <div className="status-row">
                <span>Dictionary loading</span>
                <strong>ON DEMAND</strong>
              </div>
              <div className="status-row">
                <span>Password storage</span>
                <strong>NOT INTENDED</strong>
              </div>
              <div className="status-row">
                <span>Generator</span>
                <strong>AVAILABLE</strong>
              </div>

              <div className="status-footnote">
                Describes the application's configured architecture,
                not a live threat-monitoring feed.
              </div>
            </article>
          </section>

          <section className="panel results-panel" id="security-results">
            <div className="panel-heading results-heading">
              <div>
                <div className="eyebrow">MODULE / 02</div>
                <h2>Security Assessment</h2>
                <p>Analysis results and recommendations.</p>
              </div>

              <div className="report-tag">
                {analysis ? "REPORT GENERATED" : "AWAITING INPUT"}
              </div>
            </div>

            {!analysis ? (
              <div className="empty-results">
                <div className="empty-icon" aria-hidden="true">S</div>
                <h3>No assessment available</h3>
                <p>
                  Submit a password in the analysis console to
                  generate your security report.
                </p>
              </div>
            ) : (
              <div className="results-content" aria-live="polite">
                <div className="assessment-overview">
                  <div className="strength-block">
                    <div className="result-label">PASSWORD STRENGTH</div>
                    <h3 style={{ color: colors[analysis.score] }}>
                      {analysis.strength}
                    </h3>
                    <div className="strength-meter">
                      <div
                        className="strength-fill"
                        style={{
                          width: `${(analysis.score + 1) * 20}%`,
                          backgroundColor: colors[analysis.score],
                        }}
                      />
                    </div>
                    <span className="result-caption">
                      Relative score from 0 to 4
                    </span>
                  </div>

                  <div className="score-block">
                    <div className="result-label">ENGINE SCORE</div>
                    <div className="score-value">
                      {analysis.score}<span>/4</span>
                    </div>
                    <span className="result-caption">
                      ZXCVBN assessment
                    </span>
                  </div>
                </div>

                <div className="results-detail-grid">
                  <div className="result-subpanel">
                    <div className="result-label">SECURITY CHECKLIST</div>
                    <div className="check-progress">
                      {completedChecks} / {Object.keys(analysis.checks).length}
                      {" "}checks passed
                    </div>

                    <div className="checks">
                      {Object.entries(analysis.checks).map(([key, value]) => (
                        <div className="check-item" key={key}>
                          <span>{key}</span>
                          <span className={value ? "check-pass" : "check-fail"}>
                            {value ? "\u2713 PASS" : "\u2717 REVIEW"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="result-subpanel">
                    <div className="result-label">ESTIMATED CRACKING TIME</div>
                    <div className="crack-time">{analysis.crackTime}</div>
                    <p className="result-caption">
                      Based on the analyzer's offline slow-hashing
                      attack scenario. Actual attack times vary.
                    </p>
                  </div>
                </div>

                {analysis.warning && (
                  <div className="warning">
                    <strong>ANALYSIS WARNING</strong>
                    <p>{analysis.warning}</p>
                  </div>
                )}

                <div className="recommendations">
                  <div className="result-label">
                    SECURITY RECOMMENDATIONS
                  </div>

                  {analysis.suggestions.length > 0 ? (
                    <ul>
                      {analysis.suggestions.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      No additional recommendations from the analyzer.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          <footer className="app-footer">
            <div>
              <strong>SENTINEL</strong>
              <span>SECURITY OPERATIONS / PASSWORD LAB</span>
            </div>
            <p>
              Educational security tool. Password analysis is performed
              locally in your browser.
            </p>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default App;

