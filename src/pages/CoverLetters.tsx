import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCoverLetterProfile } from '@/hooks/useCoverLetterProfile';
import { useJobApplications } from '@/hooks/useJobApplications';
import ProfileForm from '@/components/cover-letters/ProfileForm';
import ApplicationWizard from '@/components/cover-letters/ApplicationWizard';
import ApplicationHistory from '@/components/cover-letters/ApplicationHistory';
import { Briefcase } from 'lucide-react';

export default function CoverLetters() {
  const { profile, loading: profileLoading, saveProfile, hasProfile } = useCoverLetterProfile();
  const {
    applications, loading: appsLoading, saveApplication, deleteApplication,
    analyzeMatch, answerQuestion, generateLetter, parseJobListing, scrapeJobUrl,
  } = useJobApplications();

  const defaultTab = hasProfile ? 'apply' : 'profile';

  if (profileLoading) {
    return <div className="text-sm text-muted-foreground py-8">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Briefcase className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Job Applications</h1>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="apply">Apply</TabsTrigger>
          <TabsTrigger value="profile">My Profile</TabsTrigger>
          <TabsTrigger value="history">History ({applications.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="apply" forceMount className="data-[state=inactive]:hidden">
          {!hasProfile ? (
            <div className="border rounded-lg p-6 bg-card text-center space-y-3">
              <p className="text-sm text-muted-foreground">Set up your profile first so the AI knows your experience.</p>
            </div>
          ) : (
            <ApplicationWizard
              profile={profile!}
              onAnalyzeMatch={analyzeMatch}
              onAnswerQuestion={answerQuestion}
              onGenerateLetter={generateLetter}
              onSave={saveApplication}
              onParseJob={parseJobListing}
              onScrape={scrapeJobUrl}
            />
          )}
        </TabsContent>

        <TabsContent value="profile">
          <ProfileForm profile={profile} onSave={saveProfile} />
        </TabsContent>

        <TabsContent value="history">
          <ApplicationHistory applications={applications} onDelete={deleteApplication} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
