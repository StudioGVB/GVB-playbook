import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';

interface LegacyProject {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  colorClass?: string;
  color_class?: string;
  monthlyCost?: number;
  monthly_cost?: number;
  notes?: string;
  nextActions?: string[];
  next_actions?: string[];
  hasMoveAI?: boolean;
  has_move_ai?: boolean;
}

interface LegacyTask {
  id: string;
  title: string;
  projectId?: string;
  project_id?: string;
  sectionId?: string;
  section_id?: string;
  priority: string;
  deadline?: string;
  notes?: string;
  completed: boolean;
}

interface LegacySection {
  id: string;
  name: string;
  projectId?: string;
  project_id?: string;
  order: number;
}

interface LegacyCost {
  id: string;
  name: string;
  amount: number;
  type: string;
  category: string;
  projectId?: string;
  project_id?: string;
}

interface LegacyBrainDump {
  id: string;
  content: string;
  createdAt?: string;
  created_at?: string;
}

interface LegacySettings {
  ukMoveDate?: string;
  uk_move_date?: string;
  availableCash?: number;
  available_cash?: number;
  monthlyNonNegotiables?: number;
  monthly_non_negotiables?: number;
}

interface LegacyData {
  projects?: LegacyProject[];
  tasks?: LegacyTask[];
  sections?: LegacySection[];
  costs?: LegacyCost[];
  brainDump?: LegacyBrainDump[];
  brain_dump?: LegacyBrainDump[];
  settings?: LegacySettings;
  weeklyPriorities?: { id: string; text: string; completed: boolean }[];
  weekly_priorities?: { id: string; text: string; completed: boolean }[];
}

export default function DataMigration() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jsonData, setJsonData] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ success: string[]; errors: string[] }>({ success: [], errors: [] });

  const extractLocalStorageData = () => {
    // Try to get data from various localStorage keys that might have been used
    const possibleKeys = [
      'app-data',
      'appData', 
      'projects',
      'tasks',
      'moveToUK',
      'move-to-uk-data'
    ];
    
    let foundData: LegacyData = {};
    
    for (const key of possibleKeys) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          foundData = { ...foundData, ...parsed };
        } catch (e) {
          console.log(`Could not parse ${key}`);
        }
      }
    }

    // Also check for individual storage
    const projectsData = localStorage.getItem('projects');
    const tasksData = localStorage.getItem('tasks');
    const sectionsData = localStorage.getItem('sections');
    const costsData = localStorage.getItem('costs');
    const brainDumpData = localStorage.getItem('brainDump');
    const settingsData = localStorage.getItem('settings');

    if (projectsData) foundData.projects = JSON.parse(projectsData);
    if (tasksData) foundData.tasks = JSON.parse(tasksData);
    if (sectionsData) foundData.sections = JSON.parse(sectionsData);
    if (costsData) foundData.costs = JSON.parse(costsData);
    if (brainDumpData) foundData.brainDump = JSON.parse(brainDumpData);
    if (settingsData) foundData.settings = JSON.parse(settingsData);

    if (Object.keys(foundData).length > 0) {
      setJsonData(JSON.stringify(foundData, null, 2));
      toast.success('Found local data! Review and click Import.');
    } else {
      toast.error('No local data found in this browser.');
    }
  };

  const migrateData = async () => {
    if (!user) {
      toast.error('You must be logged in to migrate data');
      return;
    }

    if (!jsonData.trim()) {
      toast.error('Please paste your data or click "Auto-detect"');
      return;
    }

    setImporting(true);
    const successLog: string[] = [];
    const errorLog: string[] = [];

    try {
      const data: LegacyData = JSON.parse(jsonData);
      const projectIdMap: Record<string, string> = {};
      const sectionIdMap: Record<string, string> = {};

      // 1. Import Projects
      if (data.projects && data.projects.length > 0) {
        for (const project of data.projects) {
          const { error, data: newProject } = await supabase
            .from('projects')
            .insert({
              user_id: user.id,
              name: project.name,
              slug: project.slug,
              description: project.description || null,
              status: project.status || 'active',
              color_class: project.colorClass || project.color_class || 'bg-blue-500',
              monthly_cost: project.monthlyCost || project.monthly_cost || 0,
              notes: project.notes || null,
              next_actions: project.nextActions || project.next_actions || [],
              has_move_ai: project.hasMoveAI || project.has_move_ai || false,
            })
            .select()
            .single();

          if (error) {
            errorLog.push(`Project "${project.name}": ${error.message}`);
          } else {
            projectIdMap[project.id] = newProject.id;
            successLog.push(`Project "${project.name}" imported`);
          }
        }
      }

      // 2. Import Sections (need project mapping)
      if (data.sections && data.sections.length > 0) {
        for (const section of data.sections) {
          const oldProjectId = section.projectId || section.project_id;
          const newProjectId = oldProjectId ? projectIdMap[oldProjectId] : null;
          
          if (!newProjectId) {
            errorLog.push(`Section "${section.name}": No matching project found`);
            continue;
          }

          const { error, data: newSection } = await supabase
            .from('sections')
            .insert({
              user_id: user.id,
              name: section.name,
              project_id: newProjectId,
              order: section.order || 0,
            })
            .select()
            .single();

          if (error) {
            errorLog.push(`Section "${section.name}": ${error.message}`);
          } else {
            sectionIdMap[section.id] = newSection.id;
            successLog.push(`Section "${section.name}" imported`);
          }
        }
      }

      // 3. Import Tasks (need project and section mapping)
      if (data.tasks && data.tasks.length > 0) {
        for (const task of data.tasks) {
          const oldProjectId = task.projectId || task.project_id;
          const newProjectId = oldProjectId ? projectIdMap[oldProjectId] : null;
          
          if (!newProjectId) {
            errorLog.push(`Task "${task.title}": No matching project found`);
            continue;
          }

          const oldSectionId = task.sectionId || task.section_id;
          const newSectionId = oldSectionId ? sectionIdMap[oldSectionId] : null;

          const { error } = await supabase
            .from('tasks')
            .insert({
              user_id: user.id,
              title: task.title,
              project_id: newProjectId,
              section_id: newSectionId,
              priority: task.priority || 'should',
              deadline: task.deadline || null,
              notes: task.notes || null,
              completed: task.completed || false,
            });

          if (error) {
            errorLog.push(`Task "${task.title}": ${error.message}`);
          } else {
            successLog.push(`Task "${task.title}" imported`);
          }
        }
      }

      // 4. Import Costs
      if (data.costs && data.costs.length > 0) {
        for (const cost of data.costs) {
          const oldProjectId = cost.projectId || cost.project_id;
          const newProjectId = oldProjectId ? projectIdMap[oldProjectId] : null;

          const { error } = await supabase
            .from('costs')
            .insert({
              user_id: user.id,
              name: cost.name,
              amount: cost.amount || 0,
              type: cost.type || 'one-time',
              category: cost.category || 'Other',
              project_id: newProjectId,
            });

          if (error) {
            errorLog.push(`Cost "${cost.name}": ${error.message}`);
          } else {
            successLog.push(`Cost "${cost.name}" imported`);
          }
        }
      }

      // 5. Import Brain Dump
      const brainDumpItems = data.brainDump || data.brain_dump || [];
      if (brainDumpItems.length > 0) {
        for (const note of brainDumpItems) {
          const { error } = await supabase
            .from('brain_dump')
            .insert({
              user_id: user.id,
              content: note.content,
            });

          if (error) {
            errorLog.push(`Brain dump note: ${error.message}`);
          } else {
            successLog.push('Brain dump note imported');
          }
        }
      }

      // 6. Import Weekly Priorities
      const priorities = data.weeklyPriorities || data.weekly_priorities || [];
      if (priorities.length > 0) {
        for (const priority of priorities) {
          const { error } = await supabase
            .from('weekly_priorities')
            .insert({
              user_id: user.id,
              text: priority.text,
              completed: priority.completed || false,
            });

          if (error) {
            errorLog.push(`Priority "${priority.text}": ${error.message}`);
          } else {
            successLog.push(`Priority "${priority.text}" imported`);
          }
        }
      }

      // 7. Import Settings
      if (data.settings) {
        const settings = data.settings;
        const { error } = await supabase
          .from('user_settings')
          .insert({
            user_id: user.id,
            uk_move_date: settings.ukMoveDate || settings.uk_move_date || null,
            available_cash: settings.availableCash || settings.available_cash || 0,
            monthly_non_negotiables: settings.monthlyNonNegotiables || settings.monthly_non_negotiables || 0,
          });

        if (error) {
          errorLog.push(`Settings: ${error.message}`);
        } else {
          successLog.push('Settings imported');
        }
      }

      setResults({ success: successLog, errors: errorLog });

      if (errorLog.length === 0) {
        toast.success(`Migration complete! ${successLog.length} items imported.`);
      } else {
        toast.warning(`Migration finished with ${errorLog.length} errors.`);
      }

    } catch (e) {
      toast.error('Invalid JSON data. Please check the format.');
      errorLog.push('JSON parse error');
      setResults({ success: successLog, errors: errorLog });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Migrate Local Data
          </CardTitle>
          <CardDescription>
            Import your old local storage data into your new cloud account. 
            Click "Auto-detect" to find existing data, or paste your JSON backup below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={extractLocalStorageData} variant="outline">
              Auto-detect Local Data
            </Button>
          </div>

          <Textarea
            placeholder='Paste your JSON data here, or click "Auto-detect" above...'
            value={jsonData}
            onChange={(e) => setJsonData(e.target.value)}
            className="min-h-[300px] font-mono text-sm"
          />

          <Button 
            onClick={migrateData} 
            disabled={importing || !jsonData.trim()}
            className="w-full"
          >
            {importing ? 'Importing...' : 'Import Data to Cloud'}
          </Button>

          {results.success.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-medium text-green-800 flex items-center gap-2 mb-2">
                <CheckCircle className="h-4 w-4" />
                Successfully Imported ({results.success.length})
              </h4>
              <ul className="text-sm text-green-700 max-h-40 overflow-auto">
                {results.success.map((msg, i) => (
                  <li key={i}>✓ {msg}</li>
                ))}
              </ul>
            </div>
          )}

          {results.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h4 className="font-medium text-red-800 flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4" />
                Errors ({results.errors.length})
              </h4>
              <ul className="text-sm text-red-700 max-h-40 overflow-auto">
                {results.errors.map((msg, i) => (
                  <li key={i}>✗ {msg}</li>
                ))}
              </ul>
            </div>
          )}

          {results.success.length > 0 && results.errors.length === 0 && (
            <Button onClick={() => navigate('/')} className="w-full" variant="outline">
              Go to Dashboard
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
