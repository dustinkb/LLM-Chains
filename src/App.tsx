import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Square,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Lock,
  Unlock,
  Settings,
  Key,
  RefreshCw,
  Download,
  Upload,
  Sun,
  Moon,
  Cpu,
  Layers,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Eye,
  EyeOff,
  Save,
  FileJson,
  HelpCircle,
  AlertTriangle,
  Info,
  ChevronLeft,
  ChevronRight,
  Pin,
  PinOff,
  History,
  GitCompare
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  Chain,
  Stage,
  Template,
  PRESET_TEMPLATES,
  POPULAR_GEMINI_MODELS,
  STATIC_OPENROUTER_MODELS
} from "./types";

// Unique helper for UUID generation
const generateId = () => crypto.randomUUID();

interface DiffChunk {
  type: "added" | "removed" | "unchanged";
  text: string;
}

const renderDiff = (oldStr: string, newStr: string): DiffChunk[] => {
  if (!oldStr) return [{ type: "added", text: newStr }];
  if (!newStr) return [{ type: "removed", text: oldStr }];

  const oldWords = oldStr.split(/(\s+)/);
  const newWords = newStr.split(/(\s+)/);

  const dp: number[][] = Array(oldWords.length + 1)
    .fill(null)
    .map(() => Array(newWords.length + 1).fill(0));

  for (let i = 1; i <= oldWords.length; i++) {
    for (let j = 1; j <= newWords.length; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const chunks: DiffChunk[] = [];
  let i = oldWords.length;
  let j = newWords.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      chunks.unshift({ type: "unchanged", text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      chunks.unshift({ type: "added", text: newWords[j - 1] });
      j--;
    } else {
      chunks.unshift({ type: "removed", text: oldWords[i - 1] });
      i--;
    }
  }
  return chunks;
};

const normalizeChain = (chain: any): Chain => {
  if (!chain) return chain;
  return {
    ...chain,
    stages: (chain.stages || []).map((stg) => {
      const outputs = stg.outputs || [];
      let activeOutputIndex = stg.activeOutputIndex ?? -1;

      // Migration: if stage has visual output but no outputs array
      if (outputs.length === 0 && stg.output) {
        outputs.push({
          id: "migrated-v1",
          timestamp: Date.now(),
          content: stg.output
        });
        activeOutputIndex = 0;
      }
      return {
        ...stg,
        outputs,
        activeOutputIndex
      };
    })
  };
};

export default function App() {
  // Theme state
  const [theme, setTheme] = useState<string>(() => {
    return localStorage.getItem("llm-chain-theme") || "default-dark";
  });

  // Networks and system states
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [pwaFrequency, setPwaFrequency] = useState<string>(() => {
    return localStorage.getItem("pwa-frequency") || "session";
  });
  const [pwaSuppressed, setPwaSuppressed] = useState<boolean>(() => {
    const isStandalone = 
      (window.navigator as any).standalone || 
      window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return true;

    const freq = localStorage.getItem("pwa-frequency") || "session";
    if (freq === "session") {
      return sessionStorage.getItem("pwa-session-interacted") === "true";
    } else if (freq === "daily" || freq === "weekly") {
      const lastTimeStr = localStorage.getItem("pwa-interacted-time");
      if (!lastTimeStr) return false;
      try {
        const elapsed = Date.now() - parseInt(lastTimeStr, 10);
        const limit = freq === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
        return elapsed < limit;
      } catch (e) {
        return false;
      }
    }
    return false;
  });
  const [pwaForcePreview, setPwaForcePreview] = useState<boolean>(false);

  // Loaded library collections
  const [savedChains, setSavedChains] = useState<Chain[]>(() => {
    const raw = localStorage.getItem("llm-chain-library");
    const parsed = raw ? JSON.parse(raw) : [];
    return (parsed as Chain[]).map(normalizeChain);
  });

  // Current Active Chain & Session details
  const [activeChain, setActiveChain] = useState<Chain>(() => {
    const lastActiveId = localStorage.getItem("llm-chain-active-id");
    const library = localStorage.getItem("llm-chain-library");
    const parsedLib: Chain[] = library ? JSON.parse(library) : [];
    const normalizedLib = parsedLib.map(normalizeChain);

    if (lastActiveId && normalizedLib.length > 0) {
      const found = normalizedLib.find(c => c.id === lastActiveId);
      if (found) return found;
    }

    // Default Initialization with Template 0 (PRD -> Outline -> Tasks)
    const defaultTemplate = PRESET_TEMPLATES[0];
    const initialChain = normalizeChain({
      schemaVersion: 2,
      id: generateId(),
      name: "My Workspace Chain",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: "gemini-3.5-flash",
      templateId: defaultTemplate.id,
      theme: "default-dark",
      sessionMeta: {},
      stages: [
        {
          id: "stage-0",
          prompt: "A local, offline task organizer app designed for markdown text snippets.",
          output: "",
          settings: { model: "", temperature: 0.7, topP: 0.9, lockOutput: false }
        },
        ...defaultTemplate.stages.map((stg, i) => ({
          id: `stage-${i + 1}`,
          prompt: stg.prompt,
          output: "",
          settings: { ...stg.settings }
        }))
      ]
    }) as Chain;
    return initialChain;
  });

  // Global Engine Controls & Key Ring settings
  const [globalEngine, setGlobalEngine] = useState<"gemini" | "openrouter" | "ollama">(() => {
    const last = localStorage.getItem("llm-chain-global-engine");
    return (last as any) || "gemini";
  });

  const [openRouterApiKey, setOpenRouterApiKey] = useState<string>(() => {
    return localStorage.getItem("llm-chain-openrouter-key") || "";
  });

  // Ollama local connectivity tags
  const [ollamaModels, setOllamaModels] = useState<{ id: string; name: string }[]>([]);
  const [isOllamaSearching, setIsOllamaSearching] = useState<boolean>(false);

  // OpenRouter models catalog list
  const [openRouterCatalog, setOpenRouterCatalog] = useState<{ id: string; name: string }[]>(
    STATIC_OPENROUTER_MODELS
  );

  // UI state managers
  const [showApiKeySetting, setShowApiKeySetting] = useState<boolean>(false);
  const [showLibraryList, setShowLibraryList] = useState<boolean>(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    const raw = localStorage.getItem("llm-chain-autosave");
    return raw !== "false"; // default true
  });
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Active runtime state trackers
  const [runningStageId, setRunningStageId] = useState<string | null>(null);
  const [stageStatuses, setStageStatuses] = useState<Record<string, "idle" | "processing" | "complete" | "issue" | "stopped">>({});
  const [expandedContexts, setExpandedContexts] = useState<Record<string, boolean>>({ "stage-1": true });
  const [generalToast, setGeneralToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [historyGalleryStageId, setHistoryGalleryStageId] = useState<string | null>(null);
  const [showDiffStageIds, setShowDiffStageIds] = useState<Record<string, boolean>>({});

  // Abort controllers for running streams
  const activeAbortControllers = useRef<Record<string, AbortController>>({});

  // Trigger Toast helper
  const triggerToast = (type: "success" | "error" | "info", msg: string) => {
    setGeneralToast({ type, msg });
    setTimeout(() => {
      setGeneralToast((current) => current?.msg === msg ? null : current);
    }, 4500);
  };

  // Sync window connection status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      triggerToast("success", "Device is back online.");
    };
    const handleOffline = () => {
      setIsOnline(false);
      triggerToast("info", "Device went offline. Running local models will still function.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Capture PWA Install Promotion
    const handlePwaInstall = (e: any) => {
      e.preventDefault();
      setPwaPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handlePwaInstall);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handlePwaInstall);
    };
  }, []);

  // Update light/dark attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("llm-chain-theme", theme);
  }, [theme]);

  // Discover local Ollama models on mount and globalEngine shift
  const fetchOllamaModels = async () => {
    setIsOllamaSearching(true);
    try {
      const res = await fetch("http://localhost:11434/api/tags");
      if (res.ok) {
        const data = await res.json();
        const found = (data.models || []).map((m: any) => ({
          id: `ollama:${m.name}`,
          name: `${m.name} (local)`
        }));
        setOllamaModels(found);
        if (found.length > 0) {
          triggerToast("success", `Found ${found.length} local Ollama models.`);
        }
      } else {
        setOllamaModels([]);
      }
    } catch (err) {
      // Ollama not running or CORS blocked
      setOllamaModels([]);
    } finally {
      setIsOllamaSearching(false);
    }
  };

  useEffect(() => {
    fetchOllamaModels();
  }, [globalEngine]);

  // Read OpenRouter models catalogue dynamically
  useEffect(() => {
    const loadOpenRouterCatalog = async () => {
      try {
        const res = await fetch("/api/models/openrouter");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.models.length > 0) {
            const mapped = data.models.map((m: any) => ({
              id: m.id,
              name: m.name || m.id
            }));
            setOpenRouterCatalog(mapped);
          }
        }
      } catch (err) {
        console.warn("Unable to load dynamic OpenRouter catalogue.", err);
      }
    };
    loadOpenRouterCatalog();
  }, []);

  // Sync state changes to storage
  const saveChainToLibrary = (updatedChain: Chain) => {
    const list = [...savedChains];
    const matchIdx = list.findIndex(c => c.id === updatedChain.id);
    const stamped = { ...updatedChain, updatedAt: new Date().toISOString() };
    if (matchIdx >= 0) {
      list[matchIdx] = stamped;
    } else {
      list.push(stamped);
    }
    setSavedChains(list);
    localStorage.setItem("llm-chain-library", JSON.stringify(list));
    localStorage.setItem("llm-chain-active-id", stamped.id);
    setIsDirty(false);
  };

  useEffect(() => {
    if (autoSaveEnabled) {
      saveChainToLibrary(activeChain);
    } else {
      setIsDirty(true);
    }
  }, [activeChain, autoSaveEnabled]);

  const handleManualSave = () => {
    saveChainToLibrary(activeChain);
    triggerToast("success", "Chain workspace successfully saved.");
  };

  // Switch workspace chain selection
  const handleSelectChainFromLibrary = (chainId: string) => {
    const found = savedChains.find(c => c.id === chainId);
    if (found) {
      setActiveChain(found);
      localStorage.setItem("llm-chain-active-id", found.id);
      triggerToast("success", `Loaded chain: "${found.name}"`);
      setShowLibraryList(false);
    }
  };

  const handleCreateNewChainWorkspace = () => {
    const defaultTemplate = PRESET_TEMPLATES[0];
    const brandNew: Chain = normalizeChain({
      schemaVersion: 2,
      id: generateId(),
      name: `Workspace Pipeline (${savedChains.length + 1})`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: activeChain.model || "gemini-3.5-flash",
      templateId: "blank",
      theme: "default-dark",
      sessionMeta: {},
      stages: [
        {
          id: "stage-0",
          prompt: "Raw seed context input block...",
          output: "",
          settings: { model: "", temperature: 0.7, topP: 0.9, lockOutput: false }
        },
        {
          id: generateId(),
          prompt: "Enter your custom pipeline prompt step...",
          output: "",
          settings: { model: "", temperature: 0.7, topP: 0.9, lockOutput: false }
        }
      ]
    }) as Chain;
    setActiveChain(brandNew);
    if (autoSaveEnabled) {
      const updatedList = [...savedChains, brandNew];
      setSavedChains(updatedList);
      localStorage.setItem("llm-chain-library", JSON.stringify(updatedList));
    }
    localStorage.setItem("llm-chain-active-id", brandNew.id);
    setIsDirty(false);
    triggerToast("success", "Created a new blank custom workspace pipeline.");
  };

  const handleDeleteChainFromLibrary = (chainId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedChains.filter(c => c.id !== chainId);
    setSavedChains(updated);
    localStorage.setItem("llm-chain-library", JSON.stringify(updated));

    if (activeChain.id === chainId) {
      if (updated.length > 0) {
        setActiveChain(updated[0]);
        localStorage.setItem("llm-chain-active-id", updated[0].id);
      } else {
        handleCreateNewChainWorkspace();
      }
    }
    triggerToast("success", "Workspace chain archive removed.");
  };

  // Import / Export states as JSON
  const handleExportCurrentChain = () => {
    const blobData = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      appName: "LLM Chain Processor",
      appVersion: "0.1.0",
      chains: [activeChain]
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blobData, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `${activeChain.name.toLowerCase().replace(/\s+/g, "-")}-export-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    triggerToast("success", "Successfully downloaded JSON export of active workspace.");
  };

  const handleExportFullLibrary = () => {
    const blobData = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      appName: "LLM Chain Processor",
      appVersion: "0.1.0",
      chains: savedChains.length > 0 ? savedChains : [activeChain]
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blobData, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `llm-chain-library-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    triggerToast("success", "Successfully downloaded entire workspace library JSON.");
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const file = e.target.files?.[0];
    if (!file) return;

    fileReader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed.chains || !Array.isArray(parsed.chains)) {
          throw new Error("Invalid file format. Missing standard 'chains' array.");
        }

        const importedList = parsed.chains.map((chain: any) => {
          // Verify name collisions
          let newName = chain.name || "Imported Chain Workspace";
          const collision = savedChains.some(c => c.name === newName);
          if (collision) {
            newName += " (imported)";
          }
          return {
            ...chain,
            id: generateId(), // give dynamic fresh ID
            name: newName,
            updatedAt: new Date().toISOString()
          };
        });

        const merged = [...savedChains, ...importedList];
        setSavedChains(merged);
        localStorage.setItem("llm-chain-library", JSON.stringify(merged));

        // focus on first imported chain
        if (importedList.length > 0) {
          setActiveChain(importedList[0]);
          localStorage.setItem("llm-chain-active-id", importedList[0].id);
        }

        triggerToast("success", `Successfully imported ${importedList.length} workspace chains into your library.`);
      } catch (err: any) {
        triggerToast("error", `Import aborted: ${err.message || "Failed to parse JSON schema."}`);
      }
    };
    fileReader.readAsText(file);
  };

  // Modify individual stages
  const updateStageText = (stageId: string, val: string) => {
    const editedStages = activeChain.stages.map(stg => {
      if (stg.id === stageId) {
        return { ...stg, prompt: val };
      }
      return stg;
    });
    setActiveChain(prev => ({ ...prev, stages: editedStages }));
  };

  const updateStageOutput = (stageId: string, val: string) => {
    const editedStages = activeChain.stages.map(stg => {
      if (stg.id === stageId) {
        return { ...stg, output: val };
      }
      return stg;
    });
    setActiveChain(prev => ({ ...prev, stages: editedStages }));
  };

  const addOutputToHistory = (stageId: string, content: string) => {
    if (!content.trim()) return;
    setActiveChain(prev => {
      const editedStages = prev.stages.map(stg => {
        if (stg.id === stageId) {
          const outputs = stg.outputs ? [...stg.outputs] : [];
          const newOutput = {
            id: generateId(),
            timestamp: Date.now(),
            content: content
          };
          outputs.push(newOutput);
          return {
            ...stg,
            output: content,
            outputs,
            activeOutputIndex: outputs.length - 1
          };
        }
        return stg;
      });
      return { ...prev, stages: editedStages };
    });
  };

  const handleSelectHistoryVersion = (stageId: string, index: number) => {
    setActiveChain(prev => {
      const editedStages = prev.stages.map(stg => {
        if (stg.id === stageId) {
          const outputs = stg.outputs || [];
          if (index >= 0 && index < outputs.length) {
            return {
              ...stg,
              activeOutputIndex: index,
              output: outputs[index].content
            };
          }
        }
        return stg;
      });
      return { ...prev, stages: editedStages };
    });
  };

  const handleDeleteHistoryVersion = (stageId: string, indexToDelete: number) => {
    setActiveChain(prev => {
      const editedStages = prev.stages.map(stg => {
        if (stg.id === stageId) {
          const outputs = stg.outputs ? stg.outputs.filter((_, i) => i !== indexToDelete) : [];
          let nextIndex = stg.activeOutputIndex;
          if (nextIndex >= outputs.length) {
            nextIndex = outputs.length - 1;
          }
          if (nextIndex < 0 && outputs.length > 0) {
            nextIndex = 0;
          }
          const activeContent = nextIndex >= 0 ? outputs[nextIndex].content : "";
          const pinnedId = (stg.pinnedVersionId && !outputs.some(o => o.id === stg.pinnedVersionId))
            ? undefined
            : stg.pinnedVersionId;

          return {
            ...stg,
            outputs,
            activeOutputIndex: nextIndex,
            output: activeContent,
            pinnedVersionId: pinnedId
          };
        }
        return stg;
      });
      return { ...prev, stages: editedStages };
    });
    triggerToast("success", "Deleted selected version attempt from history.");
  };

  const handleClearStageHistory = (stageId: string) => {
    setActiveChain(prev => {
      const editedStages = prev.stages.map(stg => {
        if (stg.id === stageId) {
          return {
            ...stg,
            outputs: [],
            activeOutputIndex: -1,
            output: "",
            pinnedVersionId: undefined
          };
        }
        return stg;
      });
      return { ...prev, stages: editedStages };
    });
    triggerToast("success", "Cleared entire generation history for this stage.");
  };

  const handleTogglePinVersion = (stageId: string, versionId: string) => {
    setActiveChain(prev => {
      const editedStages = prev.stages.map(stg => {
        if (stg.id === stageId) {
          const isCurrentlyPinned = stg.pinnedVersionId === versionId;
          return {
            ...stg,
            pinnedVersionId: isCurrentlyPinned ? undefined : versionId
          };
        }
        return stg;
      });
      return { ...prev, stages: editedStages };
    });
    triggerToast("success", "Successfully toggled version pinning context.");
  };

  const updateStageSettings = (stageId: string, overrides: Partial<Stage["settings"]>) => {
    const editedStages = activeChain.stages.map(stg => {
      if (stg.id === stageId) {
        return { ...stg, settings: { ...stg.settings, ...overrides } };
      }
      return stg;
    });
    setActiveChain(prev => ({ ...prev, stages: editedStages }));
  };

  // Append new stage
  const handleAddBlankStage = () => {
    const lastNum = activeChain.stages.length;
    const newStage: Stage = {
      id: generateId(),
      prompt: "State your pipeline instruction context...",
      output: "",
      outputs: [],
      activeOutputIndex: -1,
      settings: { model: "", temperature: 0.7, topP: 0.9, lockOutput: false }
    };
    setActiveChain(prev => ({ ...prev, stages: [...prev.stages, newStage] }));
    triggerToast("success", "Appended a new stage block into active workspace.");
  };

  // Swap stage sequences
  const handleShiftStageOrder = (index: number, direction: "up" | "down") => {
    // Stage 0 cannot be reordered or moved
    if (index === 0) return;

    const stagesCopy = [...activeChain.stages];
    const swapTarget = direction === "up" ? index - 1 : index + 1;

    // Boundary guards
    if (swapTarget === 0 || swapTarget >= stagesCopy.length) return;

    // Perform swap
    const temp = stagesCopy[index];
    stagesCopy[index] = stagesCopy[swapTarget];
    stagesCopy[swapTarget] = temp;

    setActiveChain(prev => ({ ...prev, stages: stagesCopy }));
    triggerToast("info", "Shifted stage sequence layout.");
  };

  // Remove pipeline stages
  const handleDeleteStage = (index: number) => {
    if (index === 0) {
      triggerToast("error", "Stage 0 (Root Seed Input) cannot be deleted.");
      return;
    }
    const filtered = activeChain.stages.filter((_, idx) => idx !== index);
    setActiveChain(prev => ({ ...prev, stages: filtered }));
    triggerToast("info", "Removed stage block from the pipeline sequence.");
  };

  // Help set suppression state based on currently selected configuration
  const setInteractedSuppression = () => {
    if (pwaFrequency === "session") {
      sessionStorage.setItem("pwa-session-interacted", "true");
    } else if (pwaFrequency === "daily" || pwaFrequency === "weekly") {
      localStorage.setItem("pwa-interacted-time", Date.now().toString());
    }
    setPwaSuppressed(true);
  };

  // Trigger PWA Installation flow
  const handleTriggerPwaInstall = () => {
    if (pwaPrompt) {
      pwaPrompt.prompt();
      pwaPrompt.userChoice.then((choice: any) => {
        if (choice.outcome === "accepted") {
          triggerToast("success", "Thank you for installing LLM Chain Processor!");
          setInteractedSuppression();
          setPwaPrompt(null);
        } else {
          triggerToast("info", "PWA installation postponed.");
          setInteractedSuppression();
        }
      });
    } else {
      triggerToast("info", "No installation trigger is natively pending. Try running in standard Google Chrome on desktop or mobile.");
    }
  };

  // Dismiss custom banner
  const handleDismissPwaBanner = () => {
    setInteractedSuppression();
    triggerToast("info", "Install prompt postponed.");
  };

  // Edit developer configuration rules
  const handleUpdatePwaFrequency = (newFreq: string) => {
    setPwaFrequency(newFreq);
    localStorage.setItem("pwa-frequency", newFreq);

    // Dynamic reactive recalculation
    const isStandalone = 
      (window.navigator as any).standalone || 
      window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) {
      setPwaSuppressed(true);
      return;
    }

    if (newFreq === "session") {
      setPwaSuppressed(sessionStorage.getItem("pwa-session-interacted") === "true");
    } else if (newFreq === "daily" || newFreq === "weekly") {
      const lastTimeStr = localStorage.getItem("pwa-interacted-time");
      if (!lastTimeStr) {
        setPwaSuppressed(false);
        return;
      }
      try {
        const elapsed = Date.now() - parseInt(lastTimeStr, 10);
        const limit = newFreq === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
        setPwaSuppressed(elapsed < limit);
      } catch (e) {
        setPwaSuppressed(false);
      }
    } else {
      setPwaSuppressed(false);
    }
    triggerToast("success", `Suppression frequency toggled to: ${newFreq}.`);
  };

  // Reset interactive states
  const handleResetPwaStorage = () => {
    sessionStorage.removeItem("pwa-session-interacted");
    localStorage.removeItem("pwa-interacted-time");
    setPwaSuppressed(false);
    setPwaForcePreview(false);
    triggerToast("success", "PWA installation prompts reset successfully!");
  };

  // Reset all outputs to blank but keep configurations
  const handleClearAllOutputBuffers = () => {
    const reset = activeChain.stages.map(stg => ({ ...stg, output: stg.id === "stage-0" ? stg.prompt : "" }));
    setActiveChain(prev => ({ ...prev, stages: reset }));
    setStageStatuses({});
    triggerToast("info", "Cleared all generated output text structures.");
  };

  // Load a preset template
  const handlePickTemplate = (tmpl: Template) => {
    const defaultChain: Chain = normalizeChain({
      schemaVersion: 2,
      id: activeChain.id, // keep current workspace id
      name: `${tmpl.name} Workspace`,
      createdAt: activeChain.createdAt,
      updatedAt: new Date().toISOString(),
      model: tmpl.defaultModel,
      templateId: tmpl.id,
      theme: theme,
      sessionMeta: {},
      stages: [
        {
          id: "stage-0",
          prompt: "Provide your initial, raw root seed topic concept input...",
          output: "",
          settings: { model: "", temperature: 0.7, topP: 0.9, lockOutput: false }
        },
        ...tmpl.stages.map((stg, i) => ({
          id: generateId(),
          prompt: stg.prompt,
          output: "",
          settings: { ...stg.settings }
        }))
      ]
    }) as Chain;
    setActiveChain(defaultChain);
    triggerToast("success", `Initialized workspace preset: "${tmpl.name}"`);
  };

  // Core model execution loop
  const stopGeneration = (stageId: string) => {
    if (activeAbortControllers.current[stageId]) {
      activeAbortControllers.current[stageId].abort();
      delete activeAbortControllers.current[stageId];
      setStageStatuses(prev => ({ ...prev, [stageId]: "stopped" }));
      if (runningStageId === stageId) {
        setRunningStageId(null);
      }
      triggerToast("info", "Generation request cancelled by user.");
    }
  };

  const runStageSingle = async (stageId: string, index: number, isChainRun = false): Promise<string> => {
    const targetStage = activeChain.stages[index];
    if (!targetStage) return "";

    // If locked and has existing value, preserve & quickly return output
    if (targetStage.settings.lockOutput && targetStage.output && !isChainRun) {
      triggerToast("info", `Skipped stage ${index} as it is locked.`);
      return targetStage.output;
    }

    // Determine correct context: output of stage i-1
    const upstreamStage = activeChain.stages[index - 1];
    if (!upstreamStage) {
      triggerToast("error", "Failed to retrieve upstream pipeline context.");
      return "";
    }

    let upstreamContent = "";
    if (upstreamStage.id === "stage-0") {
      upstreamContent = upstreamStage.prompt;
    } else {
      const pinned = upstreamStage.pinnedVersionId && upstreamStage.outputs
        ? upstreamStage.outputs.find(o => o.id === upstreamStage.pinnedVersionId)
        : null;
      upstreamContent = pinned ? pinned.content : upstreamStage.output;
    }

    // Resolve which model to focus on: stage override or global workspace fallback
    const resolvedModel = targetStage.settings.model || activeChain.model || "gemini-3.5-flash";

    // Setup visual status states
    setStageStatuses(prev => ({ ...prev, [stageId]: "processing" }));
    setRunningStageId(stageId);
    updateStageOutput(stageId, ""); // reset output

    // Clean eventual old connection controllers
    if (activeAbortControllers.current[stageId]) {
      activeAbortControllers.current[stageId].abort();
    }
    const controller = new AbortController();
    activeAbortControllers.current[stageId] = controller;

    // Detect if model is Ollama or generic proxy engines
    const isOllamaRun = resolvedModel.startsWith("ollama:");

    // Construct precise system instructional message
    const systemInstruction = `You are a precise assistant. Use this upstream output as context for the current stage:\n\n[Output from Stage ${index - 1}]\n${upstreamContent}`;

    try {
      if (isOllamaRun) {
        // Run fully client-side directly against localhost Ollama
        const localModelName = resolvedModel.replace("ollama:", "");

        const connection = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: localModelName,
            prompt: targetStage.prompt,
            system: systemInstruction,
            options: {
              temperature: targetStage.settings.temperature,
              top_p: targetStage.settings.topP,
            },
            stream: true
          })
        });

        if (!connection.ok) {
          throw new Error(`Local Ollama error response status: ${connection.status}`);
        }

        const reader = connection.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        if (!reader) throw new Error("Could not initialize local binary reader.");

        let accumulated = "";
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";

          for (const chunk of parts) {
            const trimmed = chunk.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              const piece = parsed.response || "";
              accumulated += piece;
              updateStageOutput(stageId, accumulated);
            } catch (err) {
              // chunk parse issue or split edge
            }
          }
        }
        setStageStatuses(prev => ({ ...prev, [stageId]: "complete" }));
        delete activeAbortControllers.current[stageId];
        setRunningStageId(null);
        addOutputToHistory(stageId, accumulated);
        return accumulated;
      } else {
        // Run cloud stream proxy through Node/Express backend
        const chosenEngine = resolvedModel.startsWith("gemini") ? "gemini" : "openrouter";

        const connection = await fetch("/api/run-chain-step", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            engine: chosenEngine,
            model: resolvedModel,
            systemInstruction: systemInstruction,
            prompt: targetStage.prompt,
            temperature: targetStage.settings.temperature,
            topP: targetStage.settings.topP,
            openRouterApiKey: chosenEngine === "openrouter" ? openRouterApiKey : undefined
          })
        });

        if (!connection.ok) {
          throw new Error(`Server returned communication error (${connection.status})`);
        }

        const reader = connection.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        if (!reader) throw new Error("Failed to capture server stream reader interface.");

        let accumulated = "";
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine) continue;

            if (cleanLine.startsWith("data:")) {
              const strVal = cleanLine.substring(5).trim();
              if (strVal === "[DONE]") {
                continue;
              }

              try {
                const parsed = JSON.parse(strVal);
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
                const piece = parsed.text || "";
                accumulated += piece;
                updateStageOutput(stageId, accumulated);
              } catch (err: any) {
                if (err.message && err.message.includes("API key")) {
                  throw err;
                }
              }
            }
          }
        }

        setStageStatuses(prev => ({ ...prev, [stageId]: "complete" }));
        delete activeAbortControllers.current[stageId];
        setRunningStageId(null);
        addOutputToHistory(stageId, accumulated);
        return accumulated;
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setStageStatuses(prev => ({ ...prev, [stageId]: "stopped" }));
      } else {
        console.error("Failing Pipeline node:", err);
        setStageStatuses(prev => ({ ...prev, [stageId]: "issue" }));
        updateStageOutput(stageId, `[ERROR]: ${err.message || "An expected stream timeout occurred."}`);
        triggerToast("error", `Stage ${index} failed: ${err.message}`);
      }
      delete activeAbortControllers.current[stageId];
      setRunningStageId(null);
      return "";
    }
  };

  // Run full sequential pipeline chain
  const runFullPipelineExecution = async () => {
    // Basic validations
    const hasOpenRouterModel = activeChain.stages.some(stg => {
      const model = stg.settings.model || activeChain.model;
      return model && !model.startsWith("gemini") && !model.startsWith("ollama");
    });

    if (hasOpenRouterModel && !openRouterApiKey) {
      triggerToast("error", "An active stage requires OpenRouter. Please provide your API key.");
      setShowApiKeySetting(true);
      return;
    }

    triggerToast("info", "Starting sequential pipeline orchestration run...");

    // Iterate through Stage 1..N
    // Keep local tracks of outputs because state batches might not update immediately
    let prevSuccess = true;

    for (let idx = 1; idx < activeChain.stages.length; idx++) {
      const currentStage = activeChain.stages[idx];

      // If output lock is checked and we already have outputs, we gracefully preserve it
      if (currentStage.settings.lockOutput && currentStage.output) {
        setStageStatuses(prev => ({ ...prev, [currentStage.id]: "complete" }));
        continue;
      }

      if (!prevSuccess) {
        setStageStatuses(prev => ({ ...prev, [currentStage.id]: "stopped" }));
        continue;
      }

      // Run and wait blockingly
      const output = await runStageSingle(currentStage.id, idx, true);
      if (!output || output.startsWith("[ERROR]")) {
        prevSuccess = false;
      }
    }

    if (prevSuccess) {
      triggerToast("success", "Sequential pipeline chain execution complete.");
    } else {
      triggerToast("error", "Sequential run halted due to stage failure.");
    }
  };

  // Global model list combining presets
  const combinedModelsList = [
    ...POPULAR_GEMINI_MODELS,
    ...openRouterCatalog.map(m => ({ id: m.id, name: m.name, provider: "openrouter" })),
    ...ollamaModels.map(m => ({ id: m.id, name: m.name, provider: "ollama" }))
  ];

  return (
    <div className="min-h-screen text-[var(--text-primary)] transition-colors duration-300 bg-bg-primary">
      
      {/* 🚀 Sticky Header Area */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-3 md:px-6 py-4 border-b border-border-theme bg-bg-secondary w-full overflow-hidden max-w-[100vw]">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center shrink-0">
            <div className="w-4 h-4 bg-bg-primary rounded-sm"></div>
          </div>
          <h1 className="text-[16px] leading-[20px] w-[100px] font-bold tracking-tight text-text-primary shrink-0">LLM Chain Processor</h1>
          <div className="flex gap-1.5 ml-1 sm:ml-4 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${isOnline ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse"}`}>
              {isOnline ? "Online" : "Offline"}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-white/5 text-text-muted text-[10px] font-bold uppercase tracking-wider border border-white/10 hidden md:inline-block">v0.1.0-alpha</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${isDirty && !autoSaveEnabled ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-400" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"} hidden sm:inline-block`}>
              {isDirty && !autoSaveEnabled ? "Unsaved" : "Autosaved"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* PWA Install Button */}
          {pwaPrompt && (
            <button
              onClick={handleTriggerPwaInstall}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border-theme bg-bg-primary text-text-primary hover:bg-bg-hover transition-colors text-xs font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              <span className="hidden md:inline">Install App</span>
            </button>
          )}

          {/* Theme Toggle Button */}
          <button
            onClick={() => setTheme(prev => prev === "default-dark" ? "default-light" : "default-dark")}
            className="p-1.5 rounded-lg border border-border-theme bg-bg-secondary hover:bg-bg-hover text-text-secondary transition-colors shrink-0 cursor-pointer"
            title="Toggle Theme"
          >
            {theme === "default-dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Main Run Button */}
          <button
            onClick={runFullPipelineExecution}
            disabled={runningStageId !== null}
            className="flex items-center gap-1.5 px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-text-primary text-bg-primary text-xs font-bold cursor-pointer hover:opacity-90 transition-colors disabled:opacity-40 shrink-0"
          >
            <span className="hidden sm:inline">Run Chain</span>
            <span className="sm:hidden">Run</span>
          </button>
        </div>
      </header>

      {/* 🔮 Global User Toast Alerts */}
      {generalToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm p-4 rounded-xl border shadow-2xl animate-bounce bg-bg-primary text-text-primary border-border-theme flex items-start gap-2.5">
          {generalToast.type === "error" ? (
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          ) : (
            <Info size={18} className="text-text-primary shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="text-xs font-mono font-medium leading-relaxed">{generalToast.msg}</p>
          </div>
        </div>
      )}

      {/* 🥞 Custom PWA Floating Action Banner Overlay */}
      <AnimatePresence>
        {((pwaPrompt && !pwaSuppressed) || pwaForcePreview) && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="fixed bottom-6 left-6 right-6 md:left-auto md:max-w-md z-40 p-5 rounded-2xl border border-border-theme bg-black/95 text-text-primary shadow-2xl backdrop-blur-md"
          >
            <div className="flex gap-4">
              {/* App icon logo */}
              <div className="w-12 h-12 rounded-xl bg-text-primary flex items-center justify-center shrink-0 shadow-lg">
                <div className="w-6 h-6 bg-black rounded-md flex items-center justify-center font-bold text-white text-xs">
                  LC
                </div>
              </div>

              {/* Core description text row */}
              <div className="flex-1 space-y-1">
                <div className="flex items-start justify-between">
                  <h4 className="text-sm font-bold tracking-tight text-white font-sans">Install LLM Chain Processor</h4>
                  {pwaForcePreview && (
                    <span className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">Preview</span>
                  )}
                </div>
                <p className="text-xs text-text-secondary leading-relaxed font-sans">
                  Install this tool for immediate offline-supported usage, streamlined hardware access, and zero-latency prompt pipeline orchestration.
                </p>
              </div>
            </div>

            {/* Prompt Actions bar layout */}
            <div className="mt-4 flex items-center justify-end gap-2.5">
              <button
                onClick={handleDismissPwaBanner}
                className="px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors cursor-pointer"
              >
                Maybe Later
              </button>
              <button
                onClick={handleTriggerPwaInstall}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-text-primary text-bg-primary hover:opacity-90 rounded-lg transition-opacity cursor-pointer shadow-md"
              >
                <Download size={12} />
                Install Now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 📚 Main App container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 pb-24">
        
        {/* 🛠️ CONFIGURATION BAR PAGE column */}
        <section className="lg:col-span-4 flex flex-col gap-6">

          {/* Core Configuration settings Box */}
          <div className="rounded-2xl p-5 border border-border-theme bg-bg-secondary shadow-2xl stage-card">
            <label className="text-[10px] uppercase font-bold text-text-muted tracking-widest mb-4 block flex items-center gap-2">
              <Settings size={12} />
              Global Configuration
            </label>

            {/* Global API Engine Select */}
            <div className="mb-4">
              <span className="text-[11px] text-text-secondary mb-2 block">Primary Engine Provider</span>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-bg-tertiary border border-border-theme">
                {(["gemini", "openrouter", "ollama"] as const).map(eng => (
                  <button
                    key={eng}
                    onClick={() => {
                       setGlobalEngine(eng);
                       localStorage.setItem("llm-chain-global-engine", eng);
                    }}
                    className={`py-1.5 text-[11px] font-bold font-mono rounded-md capitalize transition-colors ${globalEngine === eng ? "bg-text-primary text-bg-primary shadow" : "text-text-muted hover:text-text-primary"}`}
                  >
                    {eng}
                  </button>
                ))}
              </div>
            </div>

            {/* Global Model Picker */}
            <div className="mb-4">
              <span className="text-[11px] text-text-secondary mb-1.5 block">Base Model</span>
              <select
                value={activeChain.model}
                onChange={(e) => setActiveChain(prev => ({ ...prev, model: e.target.value }))}
                className="w-full text-xs p-2.5 rounded-lg bg-bg-tertiary border border-border-theme text-text-primary font-mono outline-none focus:border-text-primary/40"
              >
                {/* Gemini models heading */}
                <optgroup label="Google Gemini API (Server-side)">
                  {POPULAR_GEMINI_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>

                {/* OpenRouter options */}
                <optgroup label="OpenRouter Hub Cloud">
                  {openRouterCatalog.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>

                {/* Ollama options */}
                <optgroup label="Ollama Local Engine (localhost:11434)">
                  {ollamaModels.length > 0 ? (
                    ollamaModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))
                  ) : (
                    <option disabled>No local Ollama models found</option>
                  )}
                </optgroup>
              </select>

              {globalEngine === "ollama" && ollamaModels.length === 0 && (
                <div className="mt-2 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 text-yellow-400 text-[10px] leading-relaxed flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Ollama Offline:</span> Ensure Ollama server runs (http://localhost:11434) and models are pulled. Click <button onClick={fetchOllamaModels} className="underline hover:text-white font-bold">Rescan</button>.
                  </div>
                </div>
              )}
            </div>

            {/* Dynamic OpenRouter key registration field */}
            {globalEngine === "openrouter" && (
              <div className="mb-4 p-3 rounded-xl border border-border-theme bg-bg-secondary">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-text-secondary flex items-center gap-1">
                    <Key size={12} />
                    OpenRouter Key
                  </span>
                  <button
                    onClick={() => setShowApiKeySetting(!showApiKeySetting)}
                    className="text-[10px] text-text-muted hover:text-text-primary font-mono"
                  >
                    {showApiKeySetting ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  type={showApiKeySetting ? "text" : "password"}
                  placeholder="sk-or-v1-..."
                  value={openRouterApiKey}
                  onChange={(e) => {
                    setOpenRouterApiKey(e.target.value);
                    localStorage.setItem("llm-chain-openrouter-key", e.target.value);
                  }}
                  className="w-full text-xs font-mono p-2 rounded-lg bg-bg-tertiary border border-border-theme text-text-primary outline-none focus:border-text-primary/40"
                />
                <p className="text-[9px] text-text-muted mt-1.5 leading-normal">API Keys are securely stored only inside local storage.</p>
              </div>
            )}

            {/* Autosave config toggle */}
            <div className="flex items-center justify-between font-mono text-[11px] p-2.5 rounded-lg bg-bg-tertiary border border-border-theme">
              <span className="text-text-secondary">Workspace Autosave</span>
              <button
                onClick={() => {
                  setAutoSaveEnabled(!autoSaveEnabled);
                  localStorage.setItem("llm-chain-autosave", String(!autoSaveEnabled));
                }}
                className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors ${autoSaveEnabled ? "bg-text-primary text-bg-primary" : "bg-bg-tertiary text-text-muted hover:text-text-primary"}`}
              >
                {autoSaveEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>

            {/* Manual actions if autosave disabled */}
            {!autoSaveEnabled && (
              <button
                onClick={handleManualSave}
                disabled={!isDirty}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg border border-border-theme bg-text-primary text-bg-primary hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <Save size={13} />
                Save Workspace Edits
              </button>
            )}

          </div>

          {/* Preset Custom pipeline Templates box */}
          <div className="rounded-2xl p-5 border border-border-theme bg-bg-secondary shadow-2xl stage-card">
            <label className="text-[10px] uppercase font-bold text-text-muted tracking-widest mb-3 block flex items-center gap-2">
              <Layers size={12} />
              Preset Templates
            </label>
            <p className="text-[11px] text-text-secondary mb-4 leading-relaxed">Select a preset to bootstrap a custom dynamic model generation step chain:</p>

            <div className="flex flex-col gap-2">
              {PRESET_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => handlePickTemplate(tmpl)}
                  className="w-full text-left p-3 rounded-xl border border-border-light hover:border-text-muted bg-bg-primary hover:bg-bg-hover transition-all group cursor-pointer"
                >
                  <p className="text-xs font-bold text-text-secondary group-hover:text-text-primary transition-colors">{tmpl.name}</p>
                  <p className="text-[10px] text-text-muted leading-relaxed mt-1">{tmpl.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Saved Workspace library catalogue */}
          <div className="rounded-2xl p-5 border border-border-theme bg-bg-secondary shadow-2xl stage-card">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] uppercase font-bold text-text-muted tracking-widest m-0 flex items-center gap-2">
                <FileJson size={12} />
                Chains Library
              </label>
              <button
                onClick={handleCreateNewChainWorkspace}
                className="text-[10px] font-bold font-mono px-2 py-1 bg-text-primary text-bg-primary hover:opacity-90 rounded-md transition-colors"
              >
                + New
              </button>
            </div>

            <p className="text-[11px] text-text-secondary mb-4 leading-relaxed">Port and synchronize multiple chain worksheets dynamically:</p>

            {savedChains.length === 0 ? (
              <div className="p-4 text-center border border-dashed border-border-theme rounded-xl text-text-muted text-[10px] font-mono bg-bg-primary">
                No archived paths in your library.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                {savedChains.map(ch => (
                  <div
                    key={ch.id}
                    onClick={() => handleSelectChainFromLibrary(ch.id)}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer group ${activeChain.id === ch.id ? "border-text-primary bg-text-primary/5" : "border-border-light bg-bg-primary hover:border-text-primary/35"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-bold leading-none truncate ${activeChain.id === ch.id ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"}`}>{ch.name}</p>
                      <p className="text-[9px] text-text-muted font-mono mt-1">Stages: {ch.stages.length} • {ch.model}</p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteChainFromLibrary(ch.id, e)}
                      className="p-1 text-red-500 hover:text-red-400 rounded shrink-0 ml-2 transition-colors"
                      title="Delete from archive"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Import / Export Controls ROW */}
            <div className="mt-4 pt-4 border-t border-border-theme grid grid-cols-2 gap-2">
              <button
                onClick={handleExportCurrentChain}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold uppercase font-mono border border-border-theme bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all"
              >
                <Download size={11} />
                Export
              </button>
              <button
                onClick={handleExportFullLibrary}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold uppercase font-mono border border-border-theme bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all"
              >
                <Upload size={11} />
                Backup Lib
              </button>
            </div>

            {/* Hidden Input file reader importer */}
            <div className="mt-2.5">
              <label className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold uppercase font-mono border border-dashed border-border-theme bg-bg-primary text-text-muted hover:text-text-primary cursor-pointer hover:bg-bg-hover transition-all">
                <FileJson size={11} />
                Import JSON Chain
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportJsonFile}
                  className="hidden"
                />
              </label>
            </div>

          </div>

          {/* PWA Settings and Diagnostic tool */}
          <div className="rounded-2xl p-5 border border-border-theme bg-bg-secondary shadow-2xl stage-card">
            <label className="text-[10px] uppercase font-bold text-text-muted tracking-widest mb-3 block flex items-center gap-2">
              <Download size={12} />
              PWA Installer Settings
            </label>
            <p className="text-[11px] text-text-secondary mb-4 leading-relaxed">
              Configure Progressive Web App parameters and monitor system standalone readiness:
            </p>

            <div className="space-y-3.5">
              {/* Custom standalone status row */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-bg-tertiary border border-border-theme">
                <span className="text-[11px] text-text-muted">Current Mode</span>
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-text-primary/10 text-text-primary">
                  {((window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches) 
                    ? "Standalone (PWA)" 
                    : "Web Browser (Tab)"}
                </span>
              </div>

              {/* Install target prompt readiness status */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-bg-tertiary border border-border-theme opacity-90">
                <span className="text-[11px] text-text-muted">Browser Intent</span>
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${pwaPrompt ? "bg-emerald-500/10 text-emerald-400" : "bg-yellow-500/10 text-yellow-500"}`}>
                  {pwaPrompt ? "Can Install" : "Awaiting Event"}
                </span>
              </div>

              {/* Frequency adjustment selectors */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-text-secondary block">Prompt Frequency</span>
                <select
                  value={pwaFrequency}
                  onChange={(e) => handleUpdatePwaFrequency(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg bg-bg-tertiary border border-border-theme text-text-primary font-mono outline-none focus:border-text-primary/40 focus:ring-1 focus:ring-text-primary/30"
                >
                  <option value="session">Each Session (Default)</option>
                  <option value="daily">Daily Prompt (24h Delay)</option>
                  <option value="weekly">Weekly Prompt (7d Delay)</option>
                  <option value="always">Always Show Banner</option>
                </select>
              </div>

              {/* Install button (if event exists) */}
              {pwaPrompt ? (
                <button
                  onClick={handleTriggerPwaInstall}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg border border-border-theme bg-text-primary text-bg-primary hover:opacity-90 transition-colors cursor-pointer"
                >
                  <Download size={13} fill="currentColor" />
                  Install Application
                </button>
              ) : (
                <div className="p-3 text-center rounded-lg border border-border-theme bg-bg-tertiary text-[10px] text-text-muted leading-relaxed">
                  To install, visit in standard Google Chrome, Edge, or Safari on your mobile or desktop device.
                </div>
              )}

              {/* Custom force banner overlay toggle */}
              <div className="pt-2 border-t border-border-light grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setPwaForcePreview(!pwaForcePreview);
                    if (!pwaForcePreview) {
                      setPwaSuppressed(false); // unsuspress to reveal banner
                    }
                    triggerToast("info", pwaForcePreview ? "Preview closed." : "Showing PWA banner design mockup.");
                  }}
                  className={`py-1.5 rounded text-[10px] font-bold uppercase transition-colors text-center border cursor-pointer ${pwaForcePreview ? "bg-text-primary text-bg-primary border-border-theme" : "bg-bg-primary border-border-theme text-text-secondary hover:text-text-primary hover:bg-bg-hover"}`}
                >
                  {pwaForcePreview ? "Hide Preview" : "Preview Modal"}
                </button>
                <button
                  onClick={handleResetPwaStorage}
                  className="py-1.5 rounded text-[10px] font-bold uppercase transition-colors text-center border border-border-theme bg-bg-primary text-red-400 hover:bg-bg-hover cursor-pointer"
                  title="Clears all suppressed interaction states"
                >
                  Clear Memory
                </button>
              </div>

            </div>
          </div>

        </section>

        {/* ⛓️ PIPELINE STAGES column */}
        <section className="lg:col-span-8 flex flex-col gap-6">

          {/* Dynamic Master Stage Controller Toolbar */}
          <div className="rounded-2xl p-4 border border-border-theme bg-bg-secondary shadow-2xl flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">Workspace:</span>
              <input
                type="text"
                value={activeChain.name}
                onChange={(e) => setActiveChain(prev => ({ ...prev, name: e.target.value }))}
                className="text-sm font-bold bg-transparent text-text-primary border-b border-transparent focus:border-text-primary/40 focus:outline-none py-0.5 px-1 min-w-[150px] max-w-[250px]"
                placeholder="Name your workspace..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleAddBlankStage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-theme bg-bg-primary text-text-primary hover:bg-bg-hover cursor-pointer"
              >
                <Plus size={13} />
                Add Stage
              </button>
              <button
                onClick={handleClearAllOutputBuffers}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border border-border-theme bg-bg-primary text-red-400 hover:bg-bg-hover cursor-pointer"
              >
                <Trash2 size={13} />
                Clear Outputs
              </button>
              <button
                onClick={runFullPipelineExecution}
                disabled={runningStageId !== null}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold border border-border-theme bg-text-primary text-bg-primary hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Play size={13} fill="currentColor" />
                Run Chain
              </button>
            </div>
          </div>

          {/* Sequential visual node iteration */}
          <div className="relative flex flex-col gap-0">

            {activeChain.stages.map((stage, stgIdx) => {
              const matchesRunning = runningStageId === stage.id;
              const status = stageStatuses[stage.id] || "idle";

              // ROOT SEED NODE (STAGE 0)
              if (stage.id === "stage-0" || stgIdx === 0) {
                return (
                  <div key={stage.id} className="relative group">
                    <div className="stage-card bg-bg-secondary border border-border-theme rounded-2xl overflow-hidden shadow-2xl relative mb-6">
                      <div className="px-5 py-3 border-b border-border-theme bg-bg-tertiary flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded bg-text-primary text-bg-primary text-[10px] font-bold flex items-center justify-center">0</span>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">Root Input</h3>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-text-primary/5 text-text-secondary font-mono hidden sm:inline">Initialization Seed Context</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-text-primary/5 text-text-secondary font-mono sm:hidden">Seed Context</span>
                        </div>
                      </div>

                      <div className="p-5">
                        <textarea
                          rows={3}
                          value={stage.prompt}
                          onChange={(e) => updateStageText(stage.id, e.target.value)}
                          className="w-full bg-transparent text-sm text-text-secondary outline-none resize-y placeholder-text-muted leading-relaxed font-sans"
                          placeholder="Provide the raw root seed concept instruction parameters..."
                        />
                      </div>
                    </div>

                    {/* Gradient Divider line */}
                    <div className="flex justify-center h-8 w-px bg-gradient-to-b from-border-theme to-transparent mx-auto mb-6"></div>
                  </div>
                );
              }

              // Pipeline Stages 1...N
              const isCollapsed = !expandedContexts[stage.id];
              const previousStage = activeChain.stages[stgIdx - 1];
              const resolvedModelOverride = stage.settings.model || activeChain.model || "gemini-3.5-flash";

              return (
                <div key={stage.id} className="relative group animate-fade-in">
                  
                  <div className="stage-card bg-bg-secondary border border-border-theme rounded-2xl overflow-hidden shadow-2xl relative mb-6">
                    
                    {/* Step Card Header bar */}
                    <div className="px-5 py-3 border-b border-border-theme bg-bg-tertiary flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded bg-text-primary text-bg-primary text-[10px] font-bold flex items-center justify-center">
                          {stgIdx}
                        </span>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">Stage {stgIdx}: Prompt Strategy</h3>
                          <p className="text-[10px] font-mono text-text-muted truncate max-w-xs">{resolvedModelOverride}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Status notification tag */}
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold font-mono uppercase tracking-wider border ${
                          status === "processing" ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-500 animate-pulse" :
                          status === "complete" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                          status === "issue" ? "bg-red-500/10 border-red-500/20 text-red-500" :
                          status === "stopped" ? "bg-neutral-500/10 border-neutral-500/20 text-neutral-400" :
                          "bg-text-primary/5 border-border-theme text-text-muted"
                        }`}>
                          {status}
                        </span>

                        {/* Reordering indicators */}
                        <div className="flex items-center gap-0.5 border-l border-r border-border-theme px-1.5">
                          <button
                            onClick={() => handleShiftStageOrder(stgIdx, "up")}
                            disabled={stgIdx === 1}
                            className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors cursor-pointer"
                            title="Move Stage Up"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            onClick={() => handleShiftStageOrder(stgIdx, "down")}
                            disabled={stgIdx === activeChain.stages.length - 1}
                            className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors cursor-pointer"
                            title="Move Stage Down"
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>

                        {/* Lock action padlock toggle */}
                        <button
                          onClick={() => updateStageSettings(stage.id, { lockOutput: !stage.settings.lockOutput })}
                          className={`p-1.5 rounded hover:bg-bg-hover transition-colors cursor-pointer ${stage.settings.lockOutput ? "text-yellow-400" : "text-text-muted hover:text-text-primary"}`}
                          title={stage.settings.lockOutput ? "Output preserved (Skipped on run)" : "Output dynamically regenerated on request"}
                        >
                          {stage.settings.lockOutput ? <Lock size={13} /> : <Unlock size={13} />}
                        </button>

                        {/* Delete Stage trigger */}
                        <button
                          onClick={() => handleDeleteStage(stgIdx)}
                          className="p-1.5 rounded text-red-500 hover:text-red-400 hover:bg-red-500/10 shrink-0 cursor-pointer"
                          title="Delete Page Node"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* History Navigation row */}
                    {(() => {
                      const outputsList = stage.outputs || [];
                      const hasHistory = outputsList.length > 0;
                      const activeIdx = stage.activeOutputIndex ?? -1;
                      const activeVersion = hasHistory && activeIdx >= 0 && activeIdx < outputsList.length ? outputsList[activeIdx] : null;
                      
                      const getFormattedTime = (timestamp: number) => {
                        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 
                               ' - ' + new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
                      };

                      if (!hasHistory) return null;

                      return (
                        <div className="px-5 py-2.5 border-b border-border-theme bg-bg-tertiary/60 flex items-center justify-between gap-4 flex-wrap text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-text-muted tracking-wide flex items-center gap-1">
                              <History size={11} /> History:
                            </span>
                            <span className="font-semibold text-text-primary">
                              Version {activeIdx + 1} of {outputsList.length}
                            </span>
                            {activeVersion && (
                              <span className="text-[10px] text-text-muted font-mono">
                                ({getFormattedTime(activeVersion.timestamp)})
                              </span>
                            )}
                            {stage.pinnedVersionId && activeVersion && stage.pinnedVersionId === activeVersion.id && (
                              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-bold">
                                <Pin size={10} fill="currentColor" /> Pinned Context
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {/* Navigation Controls */}
                            <div className="flex items-center gap-1 border border-border-theme rounded bg-bg-primary overflow-hidden p-0.5">
                              <button
                                onClick={() => handleSelectHistoryVersion(stage.id, activeIdx - 1)}
                                disabled={activeIdx <= 0}
                                className="p-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 rounded transition-all cursor-pointer"
                                title="Previous Generation Attempt"
                              >
                                <ChevronLeft size={12} />
                              </button>
                              <span className="px-1 text-[10px] font-mono font-bold text-text-muted">
                                {activeIdx + 1}/{outputsList.length}
                              </span>
                              <button
                                onClick={() => handleSelectHistoryVersion(stage.id, activeIdx + 1)}
                                disabled={activeIdx >= outputsList.length - 1}
                                className="p-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 rounded transition-all cursor-pointer"
                                title="Next Generation Attempt"
                              >
                                <ChevronRight size={12} />
                              </button>
                            </div>

                            {/* Pin Version */}
                            {activeVersion && (
                              <button
                                onClick={() => handleTogglePinVersion(stage.id, activeVersion.id)}
                                className={`p-1 border transition-all cursor-pointer flex items-center justify-center gap-1 text-[10px] font-medium h-[26px] px-2 rounded-md ${
                                  stage.pinnedVersionId === activeVersion.id
                                    ? "bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                                    : "bg-bg-primary border-border-theme text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                                }`}
                                title={stage.pinnedVersionId === activeVersion.id ? "Unpin this version from downstream pipelines" : "Pin this version to freeze context for subsequent stages"}
                              >
                                {stage.pinnedVersionId === activeVersion.id ? <Pin size={11} fill="currentColor" /> : <Pin size={11} />}
                                {stage.pinnedVersionId === activeVersion.id ? "Pinned" : "Pin Version"}
                              </button>
                            )}

                            {/* Quick Preview Gallery */}
                            <button
                              onClick={() => setHistoryGalleryStageId(stage.id)}
                              className="p-1 rounded border border-border-theme bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all cursor-pointer flex items-center justify-center gap-1 text-[10px] font-medium h-[26px] px-2"
                              title="Open comparative Version Gallery snippet preview"
                            >
                              <Layers size={11} />
                              Gallery
                            </button>

                            {/* Diff switch */}
                            {outputsList.length > 1 && activeIdx > 0 && (
                              <button
                                onClick={() => setShowDiffStageIds(prev => ({ ...prev, [stage.id]: !prev[stage.id] }))}
                                className={`p-1 border transition-all cursor-pointer flex items-center justify-center gap-1 text-[10px] font-medium h-[26px] px-2 rounded-md ${
                                  showDiffStageIds[stage.id]
                                    ? "bg-purple-500/15 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                                    : "bg-bg-primary border-border-theme text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                                }`}
                                title="Show visual word differences compared to preceeding version attempt"
                              >
                                <GitCompare size={11} />
                                {showDiffStageIds[stage.id] ? "Plain Output" : "Diff View"}
                              </button>
                            )}

                            {/* Single Delete Version */}
                            <button
                              onClick={() => handleDeleteHistoryVersion(stage.id, activeIdx)}
                              className="p-1 rounded hover:bg-red-500/10 text-red-400 border border-border-theme hover:border-red-500/20 transition-all cursor-pointer h-[26px] w-[26px] flex items-center justify-center"
                              title="Delete current version copy"
                            >
                              <Trash2 size={11} />
                            </button>

                            {/* Clean-up Utilities clear history */}
                            <button
                              onClick={() => {
                                if (confirm("Are you sure you want to purge all generation history records for this stage?")) {
                                  handleClearStageHistory(stage.id);
                                }
                              }}
                              className="px-2 py-1 rounded text-red-500 hover:bg-red-500/10 border border-border-theme hover:border-red-500/20 text-[10px] transition-all cursor-pointer font-bold uppercase tracking-wide h-[26px] flex items-center justify-center"
                              title="Wipe stage history records"
                            >
                              Purge
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Step Card Inner contents */}
                    <div className="p-5 space-y-4">

                      {/* Dynamic upstream audit collapsibles */}
                      <div className="rounded-xl border border-border-theme bg-bg-primary overflow-hidden">
                        <button
                          onClick={() => setExpandedContexts(prev => ({ ...prev, [stage.id]: !prev[stage.id] }))}
                          className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover font-mono transition-all text-left cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5">
                            📊 Injected Context (Incoming output from Stage {stgIdx - 1})
                          </span>
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-text-primary/5 text-text-muted">
                            {isCollapsed ? "Expand" : "Collapse"}
                          </span>
                        </button>

                        {!isCollapsed && (
                          <div className="p-4 border-t border-border-theme bg-bg-tertiary text-xs text-text-secondary max-h-40 overflow-y-auto font-mono leading-relaxed select-all whitespace-pre-wrap custom-scrollbar">
                            {previousStage ? (
                              previousStage.id === "stage-0" ? previousStage.prompt : previousStage.output || "[Empty Upstream Output Buffer - Execution pending]"
                            ) : (
                              "[Faulty Context Reference]"
                            )}
                          </div>
                        )}
                      </div>

                      {/* Primary instruction prompt parameters */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] text-text-muted uppercase font-bold tracking-wider block">Prompt Instructions</span>
                        <textarea
                          rows={2.5}
                          value={stage.prompt}
                          onChange={(e) => updateStageText(stage.id, e.target.value)}
                          className="w-full bg-transparent text-sm text-text-primary font-medium outline-none border-b border-border-light pb-4 leading-relaxed resize-y placeholder-text-muted"
                          placeholder="Outline instructions logic processing parameters (e.g. Analyze technical requirements...)"
                        />
                      </div>

                      {/* Dynamic Collapsible Advanced adjustments row */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-xl border border-border-theme bg-bg-tertiary text-xs">
                        
                        {/* Step Model override configuration */}
                        <div className="md:col-span-4 flex flex-col gap-1">
                          <span className="text-[11px] font-bold text-text-secondary">Model Override</span>
                          <select
                            value={stage.settings.model}
                            onChange={(e) => updateStageSettings(stage.id, { model: e.target.value })}
                            className="w-full text-[11px] font-mono p-1.5 rounded-md bg-bg-primary border border-border-theme text-text-primary outline-none focus:border-text-primary/40"
                          >
                            <option value="">Use Global default</option>
                            {combinedModelsList.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>

                        {/* Temperature settings */}
                        <div className="md:col-span-4 flex flex-col gap-1">
                          <div className="flex items-center justify-between font-mono text-[11px]">
                            <span className="text-text-secondary font-bold">TEMP</span>
                            <span className="text-text-primary font-mono font-bold">{stage.settings.temperature}</span>
                          </div>
                          <input
                            type="range"
                            min="0.0"
                            max="2.0"
                            step="0.05"
                            value={stage.settings.temperature}
                            onChange={(e) => updateStageSettings(stage.id, { temperature: parseFloat(e.target.value) })}
                            className="w-full accent-text-primary cursor-pointer"
                          />
                        </div>

                        {/* Top P controls */}
                        <div className="md:col-span-4 flex flex-col gap-1">
                          <div className="flex items-center justify-between font-mono text-[11px]">
                            <span className="text-text-secondary font-bold">TOP P</span>
                            <span className="text-text-primary font-mono font-bold">{stage.settings.topP}</span>
                          </div>
                          <input
                            type="range"
                            min="0.0"
                            max="1.0"
                            step="0.05"
                            value={stage.settings.topP}
                            onChange={(e) => updateStageSettings(stage.id, { topP: parseFloat(e.target.value) })}
                            className="w-full accent-text-primary cursor-pointer"
                          />
                        </div>

                      </div>

                      {/* OUTPUT STREAMING PREVIEW PANEL AREA */}
                      <div className="flex flex-col rounded-xl border border-border-theme overflow-hidden bg-bg-primary shadow-inner">
                        <div className="flex items-center justify-between px-3.5 py-2 border-b border-border-light bg-bg-tertiary">
                          <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-text-secondary flex items-center gap-1.5">
                            {matchesRunning && (
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                            )}
                            🤖 Output Generated Context
                          </span>
                          
                          <div className="flex items-center gap-1.5">
                            {/* Copy prompt button */}
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(stage.prompt);
                                triggerToast("success", "Prompt copied to browser clipboard.");
                              }}
                              className="px-2 py-1 rounded bg-bg-tertiary border border-border-light text-text-primary hover:bg-bg-hover text-[9px] font-bold font-mono transition-colors cursor-pointer"
                              title="Copy prompt text parameters"
                            >
                              Copy Prompt
                            </button>
                            {/* Copy output button */}
                            <button
                              onClick={() => {
                                if (stage.output) {
                                  navigator.clipboard.writeText(stage.output);
                                  triggerToast("success", "Stage output text successfully copied.");
                                } else {
                                  triggerToast("error", "Output buffer is empty.");
                                }
                              }}
                              disabled={!stage.output}
                              className="px-2 py-1 rounded bg-bg-tertiary border border-border-light text-text-primary hover:bg-bg-hover text-[9px] font-bold font-mono transition-colors disabled:opacity-20 cursor-pointer"
                              title="Copy generated output response text"
                            >
                              Copy Output
                            </button>
                          </div>
                        </div>

                        <div className="p-4 text-xs font-mono leading-relaxed text-text-secondary bg-bg-tertiary min-h-32 max-h-96 overflow-y-auto whitespace-pre-wrap selection:bg-text-primary/25 custom-scrollbar">
                          {(() => {
                            const outputsList = stage.outputs || [];
                            const activeIdx = stage.activeOutputIndex ?? -1;
                            const isDiffActive = showDiffStageIds[stage.id] && activeIdx > 0 && outputsList[activeIdx - 1];
                            const prevContent = isDiffActive ? outputsList[activeIdx - 1].content : "";

                            if (isDiffActive && prevContent) {
                              return (
                                <div className="space-y-3 font-sans leading-relaxed text-text-primary text-xs">
                                  <div className="p-2 border border-purple-500/20 bg-purple-500/10 rounded-lg flex items-center justify-between">
                                    <span className="font-bold flex items-center gap-1.5 text-purple-400">
                                      <GitCompare size={12} /> Comparing Version {activeIdx + 1} with Version {activeIdx}
                                    </span>
                                    <span className="text-[10px] text-text-muted">
                                      Added text in <span className="text-emerald-400 font-bold">green</span>, removed in <span className="text-red-400 line-through">red</span>.
                                    </span>
                                  </div>
                                  <div className="p-3 border border-border-theme bg-bg-primary rounded-lg font-mono overflow-auto max-h-80 whitespace-pre-wrap leading-normal">
                                    {renderDiff(prevContent, stage.output || "").map((chunk, cIdx) => {
                                      if (chunk.type === "added") {
                                        return (
                                          <span key={cIdx} className="bg-emerald-500/20 text-emerald-300 px-1 py-0.5 rounded border border-emerald-500/30 mx-0.5 font-bold" title="Added">
                                            {chunk.text}
                                          </span>
                                        );
                                      } else if (chunk.type === "removed") {
                                        return (
                                          <span key={cIdx} className="bg-red-500/20 text-red-300 line-through px-1 py-0.5 rounded border border-red-500/20 mx-0.5 font-bold" title="Removed">
                                            {chunk.text}
                                          </span>
                                        );
                                      } else {
                                        return <span key={cIdx}>{chunk.text}</span>;
                                      }
                                    })}
                                  </div>
                                </div>
                              );
                            }

                            return stage.output ? (
                              stage.output
                            ) : (
                              <span className="text-text-muted italic leading-normal">
                                {status === "processing" ? "Streaming results from the AI engine..." : "Awaiting pipeline prompt sequence trigger..."}
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Runtime Node local trigger control buttons */}
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light">
                        {matchesRunning ? (
                          <button
                            onClick={() => stopGeneration(stage.id)}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-500 text-white shadow cursor-pointer transition-colors"
                          >
                            <Square size={12} fill="currentColor" />
                            Stop Step
                          </button>
                        ) : (
                          <button
                            onClick={() => runStageSingle(stage.id, stgIdx)}
                            disabled={runningStageId !== null}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-border-theme bg-text-primary text-bg-primary hover:opacity-90 disabled:opacity-40 cursor-pointer transition-colors"
                          >
                            <Play size={12} fill="currentColor" />
                            Run Step
                          </button>
                        )}
                      </div>

                    </div>

                  </div>

                  {/* Gradient Divider line */}
                  {stgIdx < activeChain.stages.length - 1 && (
                    <div className="flex justify-center h-8 w-px bg-gradient-to-b from-border-theme to-transparent mx-auto mb-6"></div>
                  )}
                </div>
              );
            })}

          </div>

        </section>

      </main>

      {/* 📋 Footer manual controls details */}
      <footer className="h-12 bg-bg-secondary border-t border-border-theme px-6 flex items-center justify-between text-[10px] text-text-muted uppercase font-bold tracking-widest mt-16">
        <div>Disk Usage: 1.2MB / 50MB (LocalStorage)</div>
        <div className="flex gap-6">
          <span>Google Gemini: Active</span>
          <span>Ollama: Ready</span>
        </div>
      </footer>

      {/* COMPARATIVE VERSION GALLERY MODAL Popup */}
      {historyGalleryStageId && (() => {
        const stage = activeChain.stages.find(s => s.id === historyGalleryStageId);
        if (!stage) return null;
        
        const outputsList = stage.outputs || [];
        const activeIdx = stage.activeOutputIndex ?? -1;

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in text-text-primary">
            <div className="w-full max-w-5xl h-[85vh] bg-bg-secondary border border-border-theme rounded-2xl flex flex-col overflow-hidden shadow-2xl relative">
              
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 bg-bg-tertiary border-b border-border-theme shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                    <History size={16} />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">Comparative Version Gallery</h2>
                    <p className="text-[10px] text-text-muted font-mono uppercase tracking-wide">
                      Select or compare previous attempts for Stage Node: <span className="text-text-secondary font-bold font-sans">{stage.id}</span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setHistoryGalleryStageId(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-bg-primary hover:bg-bg-hover border border-border-theme transition-all cursor-pointer text-text-muted hover:text-text-primary uppercase tracking-wide"
                >
                  Close Gallery
                </button>
              </div>

              {/* Grid content of cards */}
              <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-bg-primary custom-scrollbar">
                {outputsList.length === 0 ? (
                  <div className="col-span-full h-64 flex flex-col items-center justify-center text-text-muted">
                    <History size={48} className="stroke-1 opacity-20 mb-3" />
                    <p className="text-sm italic">No generation history is recorded for this stage yet.</p>
                  </div>
                ) : (
                  outputsList.map((item, idx) => {
                    const isSelected = idx === activeIdx;
                    const isPinned = stage.pinnedVersionId === item.id;
                    const formattedTime = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 
                                          ' - ' + new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border flex flex-col overflow-hidden transition-all duration-200 relative group h-[400px] ${
                          isSelected
                            ? "border-text-primary bg-bg-secondary/40 shadow-xl ring-1 ring-text-primary/10"
                            : "border-border-theme bg-bg-secondary hover:border-text-primary/40 shadow hover:shadow-lg"
                        }`}
                      >
                        {/* Header card info */}
                        <div className="px-4 py-3 bg-bg-tertiary/80 border-b border-border-theme flex items-center justify-between shrink-0">
                          <div>
                            <span className="text-xs font-bold text-text-primary font-mono block">
                              Version {idx + 1}
                            </span>
                            <span className="text-[9px] text-text-muted font-mono block">
                              {formattedTime}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            {isPinned && (
                              <span className="p-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20" title="Pinned Output">
                                <Pin size={10} fill="currentColor" />
                              </span>
                            )}
                            <button
                              onClick={() => handleTogglePinVersion(stage.id, item.id)}
                              className={`p-1 rounded transition-colors cursor-pointer ${
                                isPinned ? "text-amber-500 hover:text-amber-400" : "text-text-muted hover:text-text-primary"
                              }`}
                              title={isPinned ? "Unpin version context" : "Pin version context"}
                            >
                              <Pin size={11} fill={isPinned ? "currentColor" : "none"} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm("Delete this version permanently?")) {
                                  handleDeleteHistoryVersion(stage.id, idx);
                                }
                              }}
                              className="p-1 rounded text-red-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                              title="Delete Version from history"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Middle Snippet text contents */}
                        <div className="flex-1 p-4 overflow-y-auto font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap bg-bg-secondary custom-scrollbar select-text selection:bg-text-primary/20">
                          {item.content || <span className="text-text-muted italic">Blank content.</span>}
                        </div>

                        {/* Bottom Actions card bar */}
                        <div className="px-4 py-2.5 bg-bg-tertiary border-t border-border-theme flex items-center justify-between shrink-0">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(item.content);
                              triggerToast("success", "Version content copied successfully.");
                            }}
                            className="text-[10px] font-bold text-text-secondary hover:text-text-primary transition-all cursor-pointer font-mono"
                          >
                            Copy Copy
                          </button>

                          <button
                            onClick={() => {
                              handleSelectHistoryVersion(stage.id, idx);
                              triggerToast("success", `Restored Stage version attempt ${idx + 1}.`);
                            }}
                            disabled={isSelected}
                            className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all tracking-wider cursor-pointer ${
                              isSelected
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 disabled:cursor-not-allowed"
                                : "bg-text-primary text-bg-primary hover:opacity-90 active:scale-95 border border-transparent"
                            }`}
                          >
                            {isSelected ? "Active View" : "Restore Version"}
                          </button>
                        </div>

                      </div>
                    );
                  })
                )}
              </div>

              {/* Master Purge Controls */}
              <div className="px-6 py-3 bg-bg-tertiary border-t border-border-theme flex items-center justify-between shrink-0">
                <span className="text-[10px] text-text-muted font-mono uppercase tracking-widest font-bold">
                  Total Versions Saved: {outputsList.length}
                </span>

                {outputsList.length > 0 && (
                  <button
                    onClick={() => {
                      if (confirm("Are you sure you want to purge all history copies for this stage node?")) {
                        handleClearStageHistory(stage.id);
                        setHistoryGalleryStageId(null);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500 border border-red-500/20 hover:text-white transition-all cursor-pointer uppercase tracking-wider"
                  >
                    Purge All Stage History
                  </button>
                )}
              </div>

            </div>
          </div>
        );
      })()}

    </div>
  );
}
